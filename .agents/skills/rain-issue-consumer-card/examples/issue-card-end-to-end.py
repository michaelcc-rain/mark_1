"""
Issue a Rain consumer card end-to-end (Python).

  1. create application  2. (optional) upload docs  3. await KYC
  4. create virtual card 5. retrieve + decrypt secrets

Run (sandbox):
  export RAIN_API_KEY=<sandbox key>
  pip install rain-sdk cryptography
  python issue_card_end_to_end.py

Uses the sandbox `approved`-last-name shortcut. Prints only last4.
"""

import os
import time
import uuid

from rain_sdk import Rain

# the bundled helper scripts (corrected crypto). The script files are kebab-case
# (generate-session-id.py / decrypt-card-secret.py), which Python's `import`
# statement can't load directly — load them by path with importlib.
import importlib.util

_SCRIPTS = os.path.join(os.path.dirname(__file__), "..", "scripts")


def _load(module_name: str, filename: str):
    spec = importlib.util.spec_from_file_location(module_name, os.path.join(_SCRIPTS, filename))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_gen = _load("rain_generate_session_id", "generate-session-id.py")
_dec = _load("rain_decrypt_card_secret", "decrypt-card-secret.py")
generate_session_id = _gen.generate_session_id
DEV_SESSIONID_PUBLIC_KEY = _gen.DEV_SESSIONID_PUBLIC_KEY
decrypt_secret = _dec.decrypt_secret

client = Rain(api_key=os.environ["RAIN_API_KEY"], environment="dev")  # "production" for live

TERMINAL_FAIL = {"denied", "locked", "canceled", "exempt"}
ACTION_REQUIRED = {"needsVerification", "needsInformation"}


def await_approval(user_id: str, timeout_s: int = 120, interval_s: int = 4):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        app = client.applications.user.get(user_id)
        status = app.application_status
        if status == "approved":
            return app
        if status in TERMINAL_FAIL:
            raise RuntimeError(f"terminal status: {status}")
        if status in ACTION_REQUIRED:
            raise RuntimeError(f"action required ({status}): redirect to applicationCompletionLink")
        time.sleep(interval_s)  # pending | manualReview | notStarted
    raise RuntimeError("timed out waiting for KYC")


def main():
    # 1. create application (sandbox: last name contains "approved")
    application = client.applications.user.create(
        ip_address="203.0.113.10",
        occupation="15-1252",
        annual_salary="50000-100000",
        account_purpose="web3Payments",
        expected_monthly_volume="1000-5000",
        is_terms_of_service_accepted=True,
        wallet_address="0x1234567890abcdef1234567890abcdef12345678",
        first_name="Jane",
        last_name="Doe approved",
        birth_date="1990-04-15",
        national_id="123456789",
        country_of_issue="US",
        email=f"jane.doe.{int(time.time())}@example.com",
        phone_country_code="1",   # required in practice; spec marks it optional
        phone_number="5125550100",
        address={"line1": "123 Main St", "city": "New York", "region": "NY",
                 "postal_code": "10001", "country_code": "US"},
        extra_headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    user_id = application.id
    print("application:", user_id, "status:", application.application_status)

    # 2. (optional) upload docs — skipped when the sandbox shortcut already approved
    if application.application_status != "approved" and os.environ.get("UPLOAD_DOCS"):
        client.applications.user.upload_document(
            user_id, document=open("passport.png", "rb"), type="passport", country_code="US")
        client.applications.user.upload_document(
            user_id, document=open("selfie.jpg", "rb"), type="selfie")

    # 3. await KYC
    await_approval(user_id)
    print("KYC approved")

    # 4. create a virtual card ($500 / rolling 30 days)
    card = client.users.create_card(
        user_id,
        type="virtual",
        limit={"amount": 50000, "frequency": "per30DayPeriod"},
        configuration={"display_name": "JANE DOE"},
        extra_headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    card_id = card.id
    print("card created:", card_id)

    # 5. retrieve + decrypt secrets (SessionId key + AES-128-GCM)
    secret_key, session_id = generate_session_id(DEV_SESSIONID_PUBLIC_KEY)
    secrets = client.cards.get_secrets(card_id, extra_headers={"SessionId": session_id})
    pan = decrypt_secret(secrets.encrypted_pan.data, secrets.encrypted_pan.iv, secret_key)
    _cvc = decrypt_secret(secrets.encrypted_cvc.data, secrets.encrypted_cvc.iv, secret_key)
    print("issued card ending", pan[-4:])  # never log the full PAN/CVC


if __name__ == "__main__":
    main()
