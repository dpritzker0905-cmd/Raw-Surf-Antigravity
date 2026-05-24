import sys
import json
import sqlite3
from utils.sqlite_helpers import get_sqlite_connection, get_db_path
import time
import os
import uuid
from datetime import datetime

# SQLite Stripe Caching & Billing Storage Path
DB_PATH = get_db_path("stripe_billing_cache.db")

# Secure Stripe environment variable support
STRIPE_API_KEY = os.environ.get("STRIPE_SECRET_KEY", "sk_test_mock_stripe_key_for_antigravity_2_0")

def init_db():
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    
    # 1. Stripe Customers Supabase Mapping
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS stripe_customers (
        customer_id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT,
        supabase_user_id TEXT NOT NULL,
        subscription_status TEXT DEFAULT 'inactive', -- 'active', 'canceled', 'past_due'
        subscription_plan TEXT,
        created_at TEXT NOT NULL
    )
    """)
    
    # 2. Stripe Payments & Commission Splits
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS stripe_payments (
        payment_intent_id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL, -- 'succeeded', 'failed', 'refunded'
        commission_platform REAL NOT NULL, -- platform cut (e.g. 20%)
        commission_provider REAL NOT NULL, -- photographer/instructor cut (e.g. 80%)
        provider_id TEXT,
        metadata TEXT, -- JSON mapping
        created_at TEXT NOT NULL,
        correlation_id TEXT
    )
    """)
    
    # Dynamic Migrations
    cursor.execute("PRAGMA table_info(stripe_payments)")
    cols = [col[1] for col in cursor.fetchall()]
    if "correlation_id" not in cols:
        cursor.execute("ALTER TABLE stripe_payments ADD COLUMN correlation_id TEXT")
    
    # 3. Webhooks processed log
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS stripe_webhooks_log (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        processed_at TEXT NOT NULL,
        error_logs TEXT
    )
    """)
    
    conn.commit()
    
    # Seed mock customers if empty
    cursor.execute("SELECT COUNT(*) FROM stripe_customers")
    if cursor.fetchone()[0] == 0:
        customers_seed = [
            ("cus_beg_01", "beginner_surfer@surf.com", "John Novice", "usr_novice_882", "active", "Stoke-Bronze-Pass", "2026-05-24T00:00:00Z"),
            ("cus_pro_02", "advanced_surfer@surf.com", "Jane Rippin", "usr_advanced_912", "active", "Elite-Stoke-Pass", "2026-05-24T00:00:00Z"),
            ("cus_photog_03", "photog_one@surf.com", "Shaka Clicker", "usr_photog_553", "inactive", None, "2026-05-24T00:00:00Z")
        ]
        cursor.executemany("""
        INSERT INTO stripe_customers (customer_id, email, name, supabase_user_id, subscription_status, subscription_plan, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """, customers_seed)
        
    conn.close()

def stripe_create_checkout_session(customer_id, amount, currency, success_url, cancel_url, metadata_dict=None, correlation_id=None):
    init_db()
    
    session_id = f"cs_test_{uuid.uuid4().hex[:12]}"
    payment_intent_id = f"pi_test_{uuid.uuid4().hex[:12]}"
    
    metadata_dict = metadata_dict or {}
    provider_id = metadata_dict.get("photographer_id", metadata_dict.get("instructor_id", "platform_admin"))
    
    # Calculate marketplace commission splits (80% to provider, 20% commission to platform)
    commission_platform = round(amount * 0.20, 2)
    commission_provider = round(amount * 0.80, 2)
    
    # Record payment intent as pending
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO stripe_payments (payment_intent_id, customer_id, amount, currency, status, commission_platform, commission_provider, provider_id, metadata, created_at, correlation_id)
    VALUES (?, ?, ?, ?, 'requires_payment_method', ?, ?, ?, ?, datetime('now'), ?)
    """, (payment_intent_id, customer_id, amount, currency, commission_platform, commission_provider, provider_id, json.dumps(metadata_dict), correlation_id))
    conn.commit()
    conn.close()
    
    return {
        "checkout_session_id": session_id,
        "payment_intent_id": payment_intent_id,
        "amount_usd": amount,
        "commission_split": {
            "platform_commission_usd": commission_platform,
            "provider_earnings_usd": commission_provider,
            "split_ratio": "20/80"
        },
        "url": f"https://checkout.stripe.com/pay/{session_id}",
        "success_url": success_url,
        "cancel_url": cancel_url,
        "status": "pending_payment",
        "correlation_id": correlation_id
    }

def stripe_create_subscription(customer_id, plan_name, monthly_price):
    init_db()
    
    sub_id = f"sub_test_{uuid.uuid4().hex[:12]}"
    
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    
    # Update customer plan & active status in cache (equivalent to Supabase sync hook)
    cursor.execute("""
    UPDATE stripe_customers 
    SET subscription_status = 'active', subscription_plan = ? 
    WHERE customer_id = ?
    """, (plan_name, customer_id))
    conn.commit()
    conn.close()
    
    return {
        "subscription_id": sub_id,
        "customer_id": customer_id,
        "plan_name": plan_name,
        "monthly_price_usd": monthly_price,
        "status": "active",
        "current_period_start": datetime.now().isoformat(),
        "current_period_end": (datetime.now().isoformat()), # Scheduled next renewal
        "message": f"Successfully activated plan '{plan_name}' for customer '{customer_id}' and synchronized Supabase profiles."
    }

def stripe_refund_payment(payment_intent_id, refund_amount=None):
    init_db()
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("SELECT amount, customer_id, status FROM stripe_payments WHERE payment_intent_id = ?", (payment_intent_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return {"success": False, "error": f"Payment Intent '{payment_intent_id}' not found."}
        
    original_amount, customer_id, status = row
    if status == "refunded":
        conn.close()
        return {"success": False, "error": f"Payment Intent '{payment_intent_id}' is already fully refunded."}
        
    amount_to_refund = refund_amount if refund_amount is not None else original_amount
    
    # Update payment status
    cursor.execute("UPDATE stripe_payments SET status = 'refunded' WHERE payment_intent_id = ?", (payment_intent_id,))
    conn.commit()
    conn.close()
    
    refund_id = f"re_test_{uuid.uuid4().hex[:12]}"
    return {
        "refund_id": refund_id,
        "payment_intent_id": payment_intent_id,
        "refunded_amount_usd": amount_to_refund,
        "status": "succeeded",
        "message": f"Payment of ${amount_to_refund} refunded successfully for customer '{customer_id}'."
    }

def stripe_transfer_payout(provider_id, amount, currency="usd"):
    # Prepares marketplace splits - transfers platform commission and coach payouts to connected accounts
    payout_id = f"tr_test_{uuid.uuid4().hex[:12]}"
    return {
        "payout_transfer_id": payout_id,
        "destination_provider_id": provider_id,
        "amount_transferred": amount,
        "currency": currency,
        "status": "succeeded",
        "message": f"Marketplace commission transfer of ${amount} paid out successfully to provider {provider_id}."
    }

def stripe_create_invoice(customer_id, amount, description):
    init_db()
    
    invoice_id = f"in_test_{uuid.uuid4().hex[:12]}"
    
    return {
        "invoice_id": invoice_id,
        "customer_id": customer_id,
        "amount_due_usd": amount,
        "description": description,
        "status": "open",
        "created_at": datetime.now().isoformat(),
        "pdf_url": f"https://stripe.com/invoices/{invoice_id}.pdf"
    }

def stripe_get_customer_payments(customer_id):
    init_db()
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
    SELECT payment_intent_id, amount, currency, status, commission_platform, commission_provider, provider_id, metadata, created_at
    FROM stripe_payments WHERE customer_id = ? ORDER BY created_at DESC
    """, (customer_id,))
    rows = cursor.fetchall()
    conn.close()
    
    payments = []
    for row in rows:
        pi_id, amt, curr, status, comm_plat, comm_prov, prov_id, meta, date = row
        payments.append({
            "payment_intent_id": pi_id,
            "amount": amt,
            "currency": curr,
            "status": status,
            "commission_platform": comm_plat,
            "commission_provider": comm_prov,
            "provider_id": prov_id,
            "metadata": json.loads(meta or "{}"),
            "created_at": date
        })
    return payments

# Webhook Handlers Emulator
def process_webhook_event(event_type, payload):
    init_db()
    event_id = f"evt_test_{uuid.uuid4().hex[:12]}"
    started_at = datetime.now().isoformat()
    
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    
    error_logs = None
    status = "PROCESSED"
    
    try:
        data = payload.get("object", {})
        
        if event_type == "charge.succeeded" or event_type == "payment_intent.succeeded":
            pi_id = data.get("id")
            # Update payment intent status to succeeded
            cursor.execute("UPDATE stripe_payments SET status = 'succeeded' WHERE payment_intent_id = ?", (pi_id,))
            
        elif event_type == "payment_intent.payment_failed":
            pi_id = data.get("id")
            cursor.execute("UPDATE stripe_payments SET status = 'failed' WHERE payment_intent_id = ?", (pi_id,))
            
        elif event_type == "customer.subscription.updated":
            cus_id = data.get("customer")
            status_val = data.get("status")
            plan_val = data.get("plan", {}).get("name", "Stoke-Gold-Pass")
            cursor.execute("UPDATE stripe_customers SET subscription_status = ?, subscription_plan = ? WHERE customer_id = ?", (status_val, plan_val, cus_id))
            
        elif event_type == "customer.subscription.deleted":
            cus_id = data.get("customer")
            cursor.execute("UPDATE stripe_customers SET subscription_status = 'canceled', subscription_plan = NULL WHERE customer_id = ?", (cus_id,))
            
        else:
            status = "IGNORED"
            
    except Exception as e:
        status = "ERROR"
        error_logs = str(e)
        
    cursor.execute("""
    INSERT INTO stripe_webhooks_log (event_id, event_type, payload, processed_at, error_logs)
    VALUES (?, ?, ?, ?, ?)
    """, (event_id, event_type, json.dumps(payload), started_at, error_logs))
    conn.commit()
    conn.close()
    
    return {
        "webhook_event_id": event_id,
        "event_type": event_type,
        "processing_status": status,
        "error_details": error_logs,
        "timestamp": started_at
    }

# JSON-RPC MCP stdio Loop
def main():
    init_db()
    
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
                
            request = json.loads(line)
            req_id = request.get("id")
            method = request.get("method")
            params = request.get("params", {})
            
            if method == "initialize":
                response = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {
                            "tools": {}
                        },
                        "serverInfo": {
                            "name": "stripe-mcp",
                            "version": "1.0.0"
                        }
                    }
                }
                
            elif method == "tools/list":
                response = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "tools": [
                            {
                                "name": "create_checkout_session",
                                "description": "Initiate a Stripe Checkout session, calculate marketplace splits (20% platform / 80% photographer), and return secure payment link URLs.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "customer_id": {"type": "string", "description": "Target Stripe customer ID"},
                                        "amount": {"type": "number", "description": "Billing amount in USD"},
                                        "currency": {"type": "string", "description": "Currency code (default: 'usd')"},
                                        "success_url": {"type": "string", "description": "Redirect URL on checkout completion"},
                                        "cancel_url": {"type": "string", "description": "Redirect URL on user cancellation"},
                                        "metadata": {
                                            "type": "object", 
                                            "description": "Dynamic metadata mapping including booking_id, photographer_id, and instructor_id for split verification"
                                        },
                                        "correlation_id": {"type": "string", "description": "Optional correlation tracking UUID"}
                                    },
                                    "required": ["customer_id", "amount", "success_url", "cancel_url"]
                                }
                            },
                            {
                                "name": "create_subscription",
                                "description": "Activate a new customer subscription plan and automatically synchronize Supabase profile access rules.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "customer_id": {"type": "string", "description": "Target Stripe customer ID"},
                                        "plan_name": {"type": "string", "description": "Membership Stoke subscription plan (e.g. 'Elite-Stoke-Pass')"},
                                        "monthly_price": {"type": "number", "description": "Pricing tier rate"}
                                    },
                                    "required": ["customer_id", "plan_name", "monthly_price"]
                                }
                            },
                            {
                                "name": "refund_payment",
                                "description": "Issue an instant partial or full transaction refund back to the customer's card.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "payment_intent_id": {"type": "string", "description": "Target Stripe Payment Intent ID"},
                                        "refund_amount": {"type": "number", "description": "Specific refund amount in USD (default: full refund)"}
                                    },
                                    "required": ["payment_intent_id"]
                                }
                            },
                            {
                                "name": "transfer_payout",
                                "description": "Disburse marketplace split payments and credit balances directly to connected photographers and instructor bank accounts.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "provider_id": {"type": "string", "description": "Recipient photographer or instructor ID"},
                                        "amount": {"type": "number", "description": "Transfer payout total"},
                                        "currency": {"type": "string", "description": "Currency code (default: 'usd')"}
                                    },
                                    "required": ["provider_id", "amount"]
                                }
                            },
                            {
                                "name": "create_invoice",
                                "description": "Draft open or paid customer invoices listing line-item bookings details and download PDFs.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "customer_id": {"type": "string", "description": "Stripe customer ID"},
                                        "amount": {"type": "number", "description": "Invoice total due"},
                                        "description": {"type": "string", "description": "Invoice descriptive details (e.g., '1-Hour Private Lesson at Malibu')"}
                                    },
                                    "required": ["customer_id", "amount", "description"]
                                }
                            },
                            {
                                "name": "get_customer_payments",
                                "description": "Retrieve comprehensive past card charges, payout transfers, and billing statuses from customer records.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "customer_id": {"type": "string", "description": "Stripe customer ID"}
                                    },
                                    "required": ["customer_id"]
                                }
                            },
                            {
                                "name": "simulate_webhook",
                                "description": "Simulate and trigger dynamic Stripe webhook processing loops (payment success/failures, renewals, cancellations) and Supabase synchronization pipelines.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "event_type": {
                                            "type": "string",
                                            "enum": ["payment_intent.succeeded", "payment_intent.payment_failed", "customer.subscription.updated", "customer.subscription.deleted"],
                                            "description": "Target event hook type"
                                        },
                                        "payload": {
                                            "type": "object",
                                            "description": "Simulated Stripe resource object (containing id, customer, status, plan)"
                                        }
                                    },
                                    "required": ["event_type", "payload"]
                                }
                            }
                        ]
                    }
                }
                
            elif method == "tools/call":
                tool_name = params.get("name")
                args = params.get("arguments", {})
                
                if tool_name == "create_checkout_session":
                    cus = args.get("customer_id")
                    amt = args.get("amount")
                    curr = args.get("currency", "usd")
                    s_url = args.get("success_url")
                    c_url = args.get("cancel_url")
                    meta = args.get("metadata", {})
                    corr = args.get("correlation_id")
                    res = stripe_create_checkout_session(cus, amt, curr, s_url, c_url, meta, corr)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "create_subscription":
                    cus = args.get("customer_id")
                    plan = args.get("plan_name")
                    price = args.get("monthly_price")
                    res = stripe_create_subscription(cus, plan, price)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "refund_payment":
                    pi = args.get("payment_intent_id")
                    amt = args.get("refund_amount")
                    res = stripe_refund_payment(pi, amt)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "transfer_payout":
                    prov = args.get("provider_id")
                    amt = args.get("amount")
                    curr = args.get("currency", "usd")
                    res = stripe_transfer_payout(prov, amt, curr)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "create_invoice":
                    cus = args.get("customer_id")
                    amt = args.get("amount")
                    desc = args.get("description")
                    res = stripe_create_invoice(cus, amt, desc)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "get_customer_payments":
                    cus = args.get("customer_id")
                    res = stripe_get_customer_payments(cus)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "simulate_webhook":
                    evt = args.get("event_type")
                    payload = args.get("payload", {})
                    res = process_webhook_event(evt, payload)
                    text_out = json.dumps(res, indent=2)
                    
                else:
                    text_out = f"Unknown tool: {tool_name}"
                    
                response = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": text_out
                            }
                        ]
                    }
                }
                
            else:
                response = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {
                        "code": -32601,
                        "message": f"Method not found: {method}"
                    }
                }
                
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()
            
        except Exception as e:
            sys.stderr.write(f"Error: {str(e)}\n")
            sys.stderr.flush()

if __name__ == "__main__":
    main()
