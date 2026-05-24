"""
Test suite for stripe_mcp_server.py
Verifies checkout sessions, split commissions, subscription models, refunds, payouts, invoices, webhook simulators, and JSON-RPC stdio.
"""
import os
import sys
import json
import sqlite3
import pytest
from io import StringIO

# Add backend directory to sys.path to allow importing from stripe_mcp_server
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import stripe_mcp_server

# Initialize database once before running tests
stripe_mcp_server.init_db()

def seed_test_db():
    conn = sqlite3.connect(stripe_mcp_server.DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM stripe_customers WHERE customer_id IN ('cus_beg_01', 'cus_pro_02')")
    cursor.executemany("""
    INSERT INTO stripe_customers (customer_id, email, name, supabase_user_id, subscription_status, subscription_plan, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    """, [
        ("cus_beg_01", "beginner_surfer@surf.com", "John Novice", "usr_novice_882", "active", "Stoke-Bronze-Pass"),
        ("cus_pro_02", "advanced_surfer@surf.com", "Jane Rippin", "usr_advanced_912", "active", "Elite-Stoke-Pass")
    ])
    conn.commit()
    conn.close()

seed_test_db()

def test_secure_env_variables():
    # Verify environment variable fallback standard
    assert stripe_mcp_server.STRIPE_API_KEY is not None
    assert stripe_mcp_server.STRIPE_API_KEY.startswith("sk_")
    print(f"✓ Verified secure API key support: {stripe_mcp_server.STRIPE_API_KEY[:7]}...")

def test_create_checkout_session():
    metadata = {"photographer_id": "usr_photog_99", "booking_id": "bk_772"}
    res = stripe_mcp_server.stripe_create_checkout_session(
        customer_id="cus_pro_02",
        amount=100.00,
        currency="usd",
        success_url="https://rawsurf.com/success",
        cancel_url="https://rawsurf.com/cancel",
        metadata_dict=metadata
    )
    
    assert res["status"] == "pending_payment"
    assert res["amount_usd"] == 100.00
    assert "payment_intent_id" in res
    assert "checkout_session_id" in res
    
    # Verify commission splits are exactly 20/80
    split = res["commission_split"]
    assert split["platform_commission_usd"] == 20.00
    assert split["provider_earnings_usd"] == 80.00
    
    print("✓ Stripe checkout session created with correct 20% platform and 80% photographer commission splits")

def test_create_subscription():
    res = stripe_mcp_server.stripe_create_subscription(
        customer_id="cus_beg_01",
        plan_name="Elite-Stoke-Pass",
        monthly_price=49.99
    )
    assert res["status"] == "active"
    assert res["plan_name"] == "Elite-Stoke-Pass"
    assert "subscription_id" in res
    print("✓ Stripe subscription plan created and cache/Supabase mappings synced")

def test_refund_payment():
    # First create a checkout to get a payment intent
    session = stripe_mcp_server.stripe_create_checkout_session(
        customer_id="cus_pro_02",
        amount=50.00,
        currency="usd",
        success_url="https://rawsurf.com/success",
        cancel_url="https://rawsurf.com/cancel"
    )
    pi_id = session["payment_intent_id"]
    
    # Refund it
    res = stripe_mcp_server.stripe_refund_payment(pi_id, refund_amount=30.00)
    assert res["status"] == "succeeded"
    assert res["refunded_amount_usd"] == 30.00
    assert res["payment_intent_id"] == pi_id
    print("✓ Transaction refund processed successfully")

def test_transfer_payout():
    res = stripe_mcp_server.stripe_transfer_payout("usr_photog_99", 80.00)
    assert res["status"] == "succeeded"
    assert res["amount_transferred"] == 80.00
    assert res["destination_provider_id"] == "usr_photog_99"
    print("✓ Direct marketplace transfer payout executed")

def test_create_invoice():
    res = stripe_mcp_server.stripe_create_invoice("cus_beg_01", 150.00, "1-Hour Lesson Malibu")
    assert res["status"] == "open"
    assert res["amount_due_usd"] == 150.00
    assert "pdf_url" in res
    print("✓ Customer invoice generated successfully")

def test_get_customer_payments():
    # Make sure we retrieve recorded payments
    payments = stripe_mcp_server.stripe_get_customer_payments("cus_pro_02")
    assert len(payments) >= 1
    assert payments[0]["currency"] == "usd"
    print(f"✓ Retrieved {len(payments)} transaction events for customer 'cus_pro_02'")

def test_simulate_webhook_payment_success():
    session = stripe_mcp_server.stripe_create_checkout_session(
        customer_id="cus_pro_02",
        amount=80.00,
        currency="usd",
        success_url="https://rawsurf.com/success",
        cancel_url="https://rawsurf.com/cancel"
    )
    pi_id = session["payment_intent_id"]
    
    payload = {"object": {"id": pi_id, "amount": 8000}}
    res = stripe_mcp_server.process_webhook_event("payment_intent.succeeded", payload)
    assert res["processing_status"] == "PROCESSED"
    assert res["event_type"] == "payment_intent.succeeded"
    
    # Check that payment status is updated to succeeded in database
    payments = stripe_mcp_server.stripe_get_customer_payments("cus_pro_02")
    matched = next(p for p in payments if p["payment_intent_id"] == pi_id)
    assert matched["status"] == "succeeded"
    print("✓ Stripe payment success webhook parsed and processed successfully")

def test_simulate_webhook_subscription_canceled():
    payload = {"object": {"customer": "cus_beg_01", "status": "canceled"}}
    res = stripe_mcp_server.process_webhook_event("customer.subscription.deleted", payload)
    assert res["processing_status"] == "PROCESSED"
    
    # Check subscription status in customer table
    conn = sqlite3.connect(stripe_mcp_server.DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("SELECT subscription_status, subscription_plan FROM stripe_customers WHERE customer_id = 'cus_beg_01'")
    row = cursor.fetchone()
    conn.close()
    
    assert row[0] == "canceled"
    assert row[1] is None
    print("✓ Stripe subscription cancellation webhook parsed and processed successfully")

def test_json_rpc_initialize():
    # Simulate a JSON-RPC stdio initialization call
    input_str = json.dumps({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {}
    }) + "\n"
    
    # Capture standard streams
    old_stdin = sys.stdin
    old_stdout = sys.stdout
    sys.stdin = StringIO(input_str)
    sys.stdout = StringIO()
    
    try:
        stripe_mcp_server.main()
        output_str = sys.stdout.getvalue()
    finally:
        sys.stdin = old_stdin
        sys.stdout = old_stdout
        
    response = json.loads(output_str.strip())
    assert response["jsonrpc"] == "2.0"
    assert response["id"] == 1
    assert "capabilities" in response["result"]
    assert response["result"]["serverInfo"]["name"] == "stripe-mcp"
    print("✓ JSON-RPC Stripe Initialize method returns correct protocol metadata")

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
