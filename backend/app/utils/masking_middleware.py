# backend/app/middleware/masking_middleware.py
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
import json
from app.utils.masking import mask_beneficiary_names_in_data

class BeneficiaryMaskingMiddleware(BaseHTTPMiddleware):
    """
    Middleware that automatically masks beneficiary names in all JSON responses.
    """

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        # Only process JSON responses
        if response.headers.get("content-type", "").startswith("application/json"):
            # Read the response body
            body = b""
            async for chunk in response.body_iterator:
                body += chunk

            try:
                # Parse JSON
                data = json.loads(body.decode("utf-8"))

                # Mask beneficiary names in the data
                masked_data = mask_beneficiary_names_in_data(data)

                # Create new response with masked data
                new_body = json.dumps(masked_data).encode("utf-8")
                return Response(
                    content=new_body,
                    status_code=response.status_code,
                    headers=dict(response.headers),
                    media_type=response.media_type,
                )
            except (json.JSONDecodeError, UnicodeDecodeError):
                # If not valid JSON, return original response
                return Response(
                    content=body,
                    status_code=response.status_code,
                    headers=dict(response.headers),
                    media_type=response.media_type,
                )

        return response