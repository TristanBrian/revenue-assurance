# Fraud scoring ML layer

How `fraud_score`/`fraud_tier` get attached to reconciliation anomalies, how
the models are trained, and how investigator feedback closes the loop. This
documents `app/services/fraud/` (plus `scripts/train_fraud_model.py`), which
sits **on top of** the reconciliation engine (`app/services/reconciliation/`)
— it enriches anomalies, it never gates or replaces them.

## Where it fits

```
run_reconciliation() / run_outbound_reconciliation()
  → produces `anomalies: list[dict]` (Missing Invoice, Underpayment, ...)
  → _score_anomalies_for_fraud() (reconciliation.py, best-effort, non-fatal)
      → fraud_scoring_service.score_anomalies()
          → feature_builder.build_feature_table()   (shared feature logic)
          → XGBoost.predict_proba()  +  IsolationForest.decision_function()
          → blends into fraud_score (0-100) + fraud_tier
  → anomalies now carry fraud_score/fraud_tier alongside break_type/status/...
```

If no model has been trained yet, every anomaly still comes back — just with
`fraud_score`/`fraud_tier` set to `None`. Same "not configured, not an error"
posture as `alert_service.py`'s SMTP gate and `anchor_service.py`'s CDP/
contract gate. Nothing about reconciliation itself depends on the model
existing.

Fraud scores are **never persisted**: anomalies aren't persisted rows either
(they're recomputed fresh on every reconciliation run — see
`reconciliation.py`'s module notes), so scoring is just another enrichment
pass over that same freshly-computed list, exactly like the
`resolution_status` overlay. There's no "score storage" table.

## The two models

Both are trained over the **same feature table**, built by the one shared
function `feature_builder.build_feature_table()` — used identically by
training (`scripts/train_fraud_model.py`) and real-time serving
(`fraud_scoring_service.score_anomalies()`/`explain_anomaly()`), by design,
so the two can never drift apart.

| Model | Type | Role |
|---|---|---|
| **XGBoost** (`fraud_xgboost.joblib`) | Supervised classifier, `scale_pos_weight`-weighted for class imbalance | Primary signal — learned from labeled fraud patterns |
| **Isolation Forest** (`fraud_isolation_forest.joblib`) | Unsupervised anomaly detector | Secondary/corroborating signal — flags anomalies that are structurally unusual even though they don't match any labeled fraud pattern XGBoost has seen |

XGBoost was chosen over SMOTE-style oversampling for the imbalance problem
because the fraud types here are qualitatively distinct (overpayment,
duplicate, ghost payment, ring membership) — synthetic interpolation between
them risks blending unrelated patterns together.

### Final score

```
combined   = 0.7 * xgb_proba + 0.3 * novelty_score   (novelty_score = min-max scaled Isolation Forest output)
fraud_score = round(combined * 100, 1)                # 0-100, always present on a scored anomaly
```

`XGB_WEIGHT`/`NOVELTY_WEIGHT` (0.7/0.3) live in `fraud_scoring_service.py` —
XGBoost weighted higher because it's the primary, labeled signal; Isolation
Forest is corroborating, not primary, for anomalies that *do* resemble known
patterns.

### Tiers are batch-relative, not a fixed cutoff

`fraud_tier` (`Likely Fraud` / `Suspicious` / `Likely Benign`) is assigned by
**percentile within the current scoring batch**, not a fixed absolute
probability threshold (not `>= 0.5`). This is deliberate, verified on a real
training run:

- Cross-validated TRAIN probabilities are sharply bimodal (near 0 or near 1).
- TEST probabilities for genuinely unseen actors top out around ~0.5 — the
  model is well-calibrated in that it withholds extreme confidence from
  actors it has no history on, while still *ranking* them correctly relative
  to each other (test average precision was still 0.818 in that run).
- Any absolute cutoff carried over from TRAIN's 0–1 scale is meaningless
  against TEST's compressed 0–0.5 scale — it isn't a broken model, it's a
  scale mismatch.

The fix used everywhere (training's own threshold selection *and* serving's
`fraud_tier` assignment): flag the top `K%` most suspicious anomalies
**within whatever batch is currently being scored**, where `K` is
`expected_fraud_rate` — the historical fraud rate observed on the training
set, stored in `fraud_model_metadata.json` and never re-derived from test/
production labels.

```python
likely_cutoff     = percentile(combined, 100 * (1 - expected_fraud_rate))
suspicious_cutoff = percentile(combined, 100 * (1 - min(2*expected_fraud_rate, 0.9)))
# >= likely_cutoff      -> "Likely Fraud"
# >= suspicious_cutoff  -> "Suspicious"
# else                  -> "Likely Benign"
```

So "Suspicious" is roughly the next `expected_fraud_rate` band below
"Likely Fraud" (up to 2x the expected rate total flagged as fraud-ish).

## Features (`feature_builder.FEATURE_COLUMNS`)

One row per anomaly dict, 9 columns, all numeric:

| Feature | Meaning |
|---|---|
| `flow_direction_outbound` | 1.0 if outbound (stipend chain), 0.0 if inbound (dispatch chain) |
| `anomaly_type_code` | `break_type` integer-encoded via a **fixed** dict (`ANOMALY_TYPE_CODES`), not `pd.factorize()` — so a category maps to the same integer across every training/scoring run regardless of which categories happen to appear in a given batch |
| `materiality_ratio` | `leakage_kes / max(dispatched_kes, 1)` — leakage as a *share* of expected value, not a raw amount (a 1M leak reads very differently on a 100M chain vs a 1.2M one) |
| `value_delta_zscore` | Per-actor statistical outlier score, from `detective_service.compute_omc_risk_features()` — **inbound only**; always 0.0 for outbound (no officer-level equivalent built yet — see "Known gaps" below) |
| `duplicate_flag` | 1.0 if part of a duplicate group (`break_type == "Duplicate Disbursement"`, or in the caller-supplied `duplicate_ids` set) |
| `graph_community_size` | Size of the actor's Louvain community, from the periodic graph snapshot; 0.0 if the actor isn't in the current snapshot yet |
| `actor_historical_anomaly_rate` | The actor's **percentile rank** (0–1) among all actors' anomaly counts *within the same batch being scored* — not a stored history table, and not max-normalized (see rationale below) |
| `aging_days` | `age_days`, as-is |
| `severity_tier_code` | `status` integer-encoded via a fixed dict (`SEVERITY_TIER_CODES`) |

Notable design choices baked into `feature_builder.py`:

- **`actor_key()`** — "the responsible actor" is `customer` (OMC name) for
  inbound anomalies, `officer_id` for outbound. Not `beneficiary_id`: a
  beneficiary having several of *their own* payments flagged mostly reflects
  bad luck or being targeted, not something to investigate the beneficiary
  for — whereas an officer with a disproportionately high anomaly rate
  across many different beneficiaries is the actual "who to investigate"
  signal.
- **`actor_historical_anomaly_rate` is a percentile rank, not
  `count / max(count)`.** Max-normalizing was tried and rejected after a
  live run: with ~35 actors total, that scheme makes the feature value
  highly specific to whichever single actor holds the batch's highest
  count, so a model trained on one set of actors sees values that never
  recur for a held-out set of *different* actors. That produced
  precision/recall of exactly 0 at test time despite meaningfully-above-
  baseline average precision — the model had signal it just couldn't
  threshold on. Percentile rank encodes "high relative to everyone else in
  this batch" the same way regardless of which actors are present, which is
  what generalizes to unseen actors.
- **No separate history table.** Every reconciliation run already
  recomputes anomalies over the *entire* history each time (nothing is
  windowed to "recent" — see `reconciliation.py`), so the current batch
  already *is* the actor's full anomaly history as of this run.
- **Graph features come from a periodic snapshot, not a live recompute.**
  Louvain clustering is a full-graph operation, too expensive to rerun per
  anomaly at real-time-scoring speed — see "Graph snapshot" below.

### Known gap (stated, not hidden)

There's no outbound equivalent of `detective_service.py`'s per-OMC
statistical features (`ghost_load_rate`, `value_delta_zscore`, ...) yet —
building one (mirroring `detective_service.py` for officers) is a real
follow-up, not done. `value_delta_zscore` defaults to `0.0` for every
outbound anomaly; the model reads that as "unremarkable on this axis," not
as a genuine "no anomaly found" result — it simply isn't informative for
outbound rows yet.

## Graph snapshot (`graph_snapshot_service.py`)

`graph_community_size` needs Louvain community membership, but Louvain
(`graph_engine.py`, via `python-louvain`'s `community_louvain.best_partition`)
is a full-graph recompute — not something to rerun per single new anomaly.

- Refreshed on a background loop every 5 minutes (`REFRESH_INTERVAL_SECONDS`
  — same cadence class as the audit trail's anchor-batch trigger), started
  from `app/main.py`'s lifespan.
- In-memory only (`{"inbound": {...}, "outbound": {...}}`, keyed by actor
  label) — a derived, disposable cache, same posture as
  `app/core/cache.py`'s reconciliation result cache. A restart just means
  the first few scoring calls see `graph_community_size = 0.0` until the
  next refresh.
- Keyed by node **label** (OMC's `customer_name`, or the raw `officer_id`),
  matching `feature_builder.actor_key()` exactly — no id-mapping join
  needed.
- A few-minutes-stale graph feature is an accepted trade for genuinely
  real-time per-anomaly scoring on every other feature.

## Training pipeline (`scripts/train_fraud_model.py`)

```bash
cd backend
python scripts/train_fraud_model.py                  # initial training run
python scripts/train_fraud_model.py --blend-feedback # also blend investigator feedback labels
```

Requires `data/raw/fraud_ground_truth.csv` (written by
`generate_kpc_data.py` — `{record_id, is_fraud_ground_truth}`, one row per
dispatch/attendance/disbursement; the owning OMC/officer's `risk_profile ==
"High"` is the ground-truth rule) and a populated `kpc.db`.

1. **Gather anomalies at `materiality=0`** — the full population, including
   small "ordinary noise" anomalies. Training only on large/materiality-
   filtered anomalies would starve the model of the negative examples it
   needs to actually discriminate.
2. **Build the labeled feature table** via the shared `feature_builder`,
   joined against ground-truth ids.
3. **Entity-aware split** — `GroupShuffleSplit` grouped by `actor_key`, 75/25.
   The same OMC/officer never appears in both train and test, otherwise the
   model could memorize a specific actor's leakage pattern instead of
   learning fraud's general shape. Rows with no resolvable actor get their
   own synthetic one-row group so they don't collapse into one giant "None"
   group. The script prints the shared-actor count for this split — should
   always be 0.
4. **Train XGBoost**, class-weighted via `scale_pos_weight = neg/pos` in the
   train split. `max_depth=3` with `reg_alpha=1.0`/`reg_lambda=2.0`/
   `min_child_weight=5` — tuned down/up from defaults deliberately: with
   only ~24 distinct actors in train, `actor_historical_anomaly_rate` takes
   very few distinct values, and an unregularized tree can trivially split
   on a value boundary that means nothing for a held-out actor. Shallower +
   regularized trees are the standard remedy for overfitting to a
   near-categorical feature with this few distinct values.
5. **Pick the classification threshold** as `percentile(test_scores, 100 *
   (1 - expected_fraud_rate))`, where `expected_fraud_rate` comes only from
   TRAIN's fraud rate (a legitimate prior), never from test labels — the
   same percentile-relative logic serving uses (see "Tiers are
   batch-relative" above). Also reports precision/recall/F1 at a fixed 0.5
   cutoff, for transparency only — not the headline numbers.
6. **Train Isolation Forest** unsupervised on the same `X_train`, with
   `contamination = clip(train_fraud_rate, 0.01, 0.5)`.
7. **Evaluate on precision / recall / F1 / average precision — not
   accuracy.** Fraud is the rare class (~8–15% of anomalies); a model that
   always predicted "not fraud" would score high accuracy while catching
   nothing.
8. **Compute global SHAP importance** (`shap.TreeExplainer`) over the test
   set, saved to `fraud_shap_summary.json` for the pitch/impact memo. Also
   sanity-checks a single-row (local) explanation works end to end before
   anything downstream depends on it — the actual per-anomaly SHAP
   explanation used in the app is recomputed live by
   `fraud_scoring_service.explain_anomaly()`, not read from this file.
9. **Serialize artifacts** to `app/ml_models/`:
   - `fraud_xgboost.joblib`, `fraud_isolation_forest.joblib`
   - `fraud_model_metadata.json` — trained_at, feature columns, split sizes,
     fraud rates, `scale_pos_weight`, `expected_fraud_rate` (the number
     serving actually uses), metrics, feedback-blend info. Overwritten each
     run — always reflects only the latest.
   - `fraud_shap_summary.json` — global feature importance.
   - `fraud_model_retrain_log.jsonl` — **append-only**, one JSON line per
     run (oldest first), so the pitch can show improvement across
     successive retrains, which the overwritten metadata file alone can't.

`fraud_model_metadata.json`'s `last_run_reference_threshold_do_not_reuse_directly`
field is exactly what its name says: this run's own test-set threshold, kept
for debugging only. Nothing should ever load it as a fixed cutoff — an
absolute probability threshold does not transfer across scoring batches (see
above).

## Explainability (SHAP)

`fraud_scoring_service.explain_anomaly()` backs
`GET /api/fraud/explain/{anomaly_id}`. It rebuilds the single-row feature
vector for that anomaly, runs `shap.TreeExplainer(xgb_model).shap_values()`,
and returns contributors sorted by `|contribution|` descending:

```json
{
  "anomaly_id": "...",
  "fraud_score": 87.3,
  "fraud_tier": "Likely Fraud",
  "base_value": 0.12,
  "contributors": [
    {"feature": "materiality_ratio", "value": 0.83, "contribution": 0.41, "direction": "toward_fraud"},
    {"feature": "actor_historical_anomaly_rate", "value": 0.95, "contribution": 0.22, "direction": "toward_fraud"},
    ...
  ]
}
```

`direction` is `"toward_fraud"` for a positive SHAP value, `"toward_benign"`
for negative — the plain-language framing is built here so the API/chat
endpoint don't need to know anything about SHAP's own value semantics.

## Chat-style explain (`chat_explain`)

`POST /api/fraud/chat` — **not an LLM call.** A lightweight, keyword-matched
canned-response function, grounded entirely in real stored SHAP/metrics data
this module already has on hand (modeled on the fraud-scoring spec's
reference `app.py` `/api/chat` pattern). Recognizes two question shapes:

- `"why is this flagged"` / `"why fraud"` / `"why this score"` — requires an
  `anomaly_id` be resolvable; answers via `explain_anomaly()`'s top 3 SHAP
  contributors.
- `"how good is the model"` / `"precision"` / `"recall"` / `"accuracy"` —
  reports the stored precision/recall/average-precision numbers from
  training metadata, with the rare-class framing for why accuracy alone
  would mislead.

Anything else returns a short menu of what it can answer — never a guess.

## Investigator feedback loop

```
Investigator resolves an anomaly with a fraud judgment
  → update_anomaly_status() (services/ebilling/e_billing.py)
      → fraud_scoring_service.record_feedback()
          → INSERT into fraud_feedback (same DB transaction as the resolution write)
```

- `fraud_feedback_label`: `"confirmed_fraud"` | `"false_positive"` |
  `"resolved_benign"` — an axis independent of the resolution's workflow
  `status` (Pending/Review Required/Resolved); an anomaly can be "Resolved"
  as either confirmed fraud or a false positive.
- `FraudFeedback` (`app/models/fraud/fraud_feedback.py`) is **append-only**,
  its own surrogate key — deliberately *not* an extra column on
  `AnomalyResolution` (which is upserted, latest-status-wins). Retraining
  needs the full history: an anomaly resolved, reopened, and re-resolved
  with a different judgment should keep every judgment, not just the
  latest.
- Written in the *same* transaction as the resolution/audit-log writes —
  the whole point of the loop is learning from real investigator
  judgments, so a judgment should never be recorded independently of the
  action that produced it.

### Blending feedback into training

`train_fraud_model.py --blend-feedback`:

- Loads `fraud_feedback`, takes the **most recent** resolution per
  `anomaly_id` (`drop_duplicates(keep="last")`).
- Overrides that anomaly's `is_fraud` label with the feedback judgment
  (`confirmed_fraud → True`, `false_positive`/`resolved_benign → False`),
  overriding the synthetic ground-truth label.
- Weights those rows `FEEDBACK_SAMPLE_WEIGHT = 5.0` vs
  `SYNTHETIC_SAMPLE_WEIGHT = 1.0` in `xgb_model.fit(..., sample_weight=...)`
  — real investigator judgment counts more than the generation-time proxy
  rule.

### Automatic retrain trigger (`maybe_retrain` / `run_periodic_retrain_check`)

Started from `app/main.py`'s lifespan (`run_periodic_retrain_check`, hourly
poll by default) alongside the graph-snapshot refresh loop. The loop is just
the timer — `maybe_retrain()` is the actual decision, and it's a no-op
until a baseline model already exists (`is_configured()`; the very first
training run always happens by running `train_fraud_model.py` directly).

Retrains when **either** threshold is met (whichever comes first — same
shape as `anchor_service.maybe_anchor_chain_tip()`'s trigger):

- `RETRAIN_MIN_NEW_FEEDBACK = 20` new feedback rows since the last training
  run, **or**
- `RETRAIN_MIN_INTERVAL_SECONDS = 24 * 60 * 60` (24h) since the last
  training run.

When triggered, it shells out to `train_fraud_model.py --blend-feedback` as
a **subprocess** — deliberately not called in-process: training briefly
holds a large working set (the full anomaly feature table) and runs
CPU-bound XGBoost/SHAP work that would otherwise compete with the API
server's own event loop; a subprocess isolates that and lets the OS reclaim
everything regardless of how the run goes. `maybe_retrain()` itself is
sync and blocks on `subprocess.run(..., timeout=600)`, so the async loop
runs it via `asyncio.to_thread` to avoid stalling the event loop. On
success, `reload_models()` invalidates the module-level model cache so the
next scoring call picks up the new artifacts with no app restart needed. A
failed retrain is logged and non-fatal — serving just keeps using the
previous model.

## API surface

| Endpoint | File | Permission | Purpose |
|---|---|---|---|
| `GET /api/fraud/explain/{anomaly_id}` | `routes/fraud/scoring.py` | `view_anomaly_table` | SHAP explanation for one anomaly's score |
| `POST /api/fraud/chat` | `routes/fraud/scoring.py` | `view_anomaly_table` | Canned-response chat explain (score reasons / model quality) |
| `GET /api/graph` | `routes/fraud/graph.py` | `view_fraud_graph` | Anomaly-based fraud graph (OMC↔Depot / Officer↔Beneficiary) with Louvain communities |
| `GET /api/graph/network`, `/communities`, `/omc/{omc_id}` | `routes/fraud/graph.py` | `view_fraud_graph` | Structural OMC↔Depot graph, scored via `detective_service` |
| `GET /api/detective/risk-features[/export][/{omc_id}]` | `routes/fraud/detective.py` | `view_risk_analytics` | Raw per-OMC statistical risk features (ghost_load_rate, value_delta_zscore, depot_concentration, aging_severity, quota_utilization_pct, ...) |

`fraud_score`/`fraud_tier` themselves aren't a separate endpoint — they ride
along on every anomaly returned by `/api/reconcile*`, since scoring happens
inline inside `run_reconciliation()`/`run_outbound_reconciliation()`.

## Setup / running it end to end

```bash
cd backend
python scripts/generate_kpc_data.py     # writes data/raw/, incl. fraud_ground_truth.csv
python scripts/etl_pipeline.py          # builds kpc.db
python scripts/train_fraud_model.py     # trains + writes app/ml_models/*
uvicorn app.main:app --reload           # fraud_score/fraud_tier now populate on every /api/reconcile* call
```

Until `train_fraud_model.py` has been run at least once, `app/ml_models/`
has no artifacts, `is_configured()` returns `False` everywhere, and every
anomaly comes back with `fraud_score`/`fraud_tier` as `None` — reconciliation
itself is unaffected.

## Related docs

- `app/services/fraud/*.py` module docstrings — each file above has a
  detailed header comment; this doc summarizes and cross-references them
  rather than duplicating them line for line.
