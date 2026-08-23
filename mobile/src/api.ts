import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
const base=String(process.env.EXPO_PUBLIC_API_URL??Constants.expoConfig?.extra?.apiUrl??"http://localhost:8000").replace(/\/$/,"");
const key="flowguard_access_token";
export type Direction="inbound"|"outbound"|"all";
export type User={id:string;email:string;full_name:string|null;roles:string[];permissions:string[]};
export type Metrics={total_paid_kes:number;total_leakage_kes:number;reconciliation_rate:number;anomaly_count:number;critical_count:number;pending_count:number;review_count:number};
export type Anomaly={dispatch_id:string;customer:string;product:string;depot:string|null;leakage_kes:number;break_type:string;status:string;age_days:number;fraud_score?:number|null};
export type Alert={id:string;title:string;message:string;severity:string;created_at:string;is_read:boolean};
async function req<T>(path:string,init:RequestInit={},auth=true):Promise<T>{const h=new Headers(init.headers);h.set("Accept","application/json");if(init.body)h.set("Content-Type","application/json");if(auth){const t=await SecureStore.getItemAsync(key);if(t)h.set("Authorization","Bearer "+t)}let r:Response;try{r=await fetch(base+path,{...init,headers:h})}catch{throw new Error("Cannot reach FlowGuard at "+base+". Check the API URL and network.")}const b=await r.json().catch(()=>null);if(!r.ok)throw new Error(b?.Message??"Request failed ("+r.status+")");return b?.Data as T}
export async function login(email:string,password:string){const x=await req<{access_token:string|null;reset_required:boolean;terms_required:boolean}>("/api/auth/login",{method:"POST",body:JSON.stringify({email,password})},false);if(!x.access_token)throw new Error(x.reset_required?"Complete your password reset in the web portal.":"Accept the latest terms in the web portal.");await SecureStore.setItemAsync(key,x.access_token);return me()}
export const me=()=>req<User>("/api/auth/me");export const session=async()=>!!(await SecureStore.getItemAsync(key));export const logout=()=>SecureStore.deleteItemAsync(key);
export async function metrics(d:Direction){return(await req<{metrics:Metrics}>("/api/reconcile/metrics?materiality=100000&direction="+d,{method:"POST"})).metrics}
export async function anomalies(d:Direction){return(await req<{anomalies:Anomaly[]}>("/api/reconcile/anomalies?materiality=100000&page=1&page_size=30&direction="+d)).anomalies}
export async function alerts(){const x=await req<{alerts?:Alert[];items?:Alert[]}>("/api/alerts?page=1&page_size=30");return x.alerts??x.items??[]}
export const readAlert=(id:string)=>req("/api/alerts/"+encodeURIComponent(id)+"/read",{method:"POST"});
export async function ask(message:string){return(await req<{reply:string}>("/api/fraud/chat",{method:"POST",body:JSON.stringify({message,anomaly_id:null})})).reply}
