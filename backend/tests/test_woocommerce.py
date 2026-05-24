"""
Test suite for woocommerce_mcp_server.py
Verifies shaper marketplace product creation, variable attributes, stock syncs, listing moderations, Cloudinary attachments, and JSON-RPC stdio.
"""
import os
import sys
import json
import sqlite3
import pytest
from io import StringIO

# Add backend directory to sys.path to allow importing from woocommerce_mcp_server
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import woocommerce_mcp_server

# Initialize database once before running tests
woocommerce_mcp_server.init_db()

def seed_test_db():
    conn = sqlite3.connect(woocommerce_mcp_server.DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    
    # Clean up test rows
    cursor.execute("DELETE FROM marketplace_sellers WHERE seller_id IN ('sel_shaper_01', 'sel_shaper_02')")
    cursor.execute("DELETE FROM marketplace_products WHERE product_id IN ('prod_fish_01', 'prod_thruster_02')")
    cursor.execute("DELETE FROM product_variations WHERE variation_id IN ('var_fish_01_blue', 'var_fish_01_orange', 'var_thruster_02_white')")
    
    # Re-insert cleanly
    cursor.executemany("""
    INSERT INTO marketplace_sellers (seller_id, name, company_name, email, status, rating, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    """, [
        ("sel_shaper_01", "Al Merrick", "Channel Islands Surfboards", "shaper_al@cisurf.com", "active", 4.9),
        ("sel_shaper_02", "Lost Surf", "Lost Surfboards Co", "lost_shapes@lost.com", "active", 4.8)
    ])
    
    cursor.executemany("""
    INSERT INTO marketplace_products (product_id, seller_id, name, type, status, base_price, description, categories, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    """, [
        ("prod_fish_01", "sel_shaper_01", "Retro Twin Fin Fish", "variable", "approved", 799.00, "Classic swallow tail twin fin surfboard perfect for speed.", json.dumps(["Fish", "Twin Fin"])),
        ("prod_thruster_02", "sel_shaper_02", "Performance Pro Thruster", "variable", "approved", 850.00, "Aggressive high-performance thruster board for radical carves.", json.dumps(["Shortboard", "Thruster"]))
    ])
    
    cursor.executemany("""
    INSERT INTO product_variations (variation_id, product_id, size, color, fin_setup, price, stock_quantity, overlay_image_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    """, [
        ("var_fish_01_blue", "prod_fish_01", "5'10", "Ocean Blue", "Twin Fin", 799.00, 3, "https://res.cloudinary.com/rawsurf/image/upload/v12/fish_blue_overlay.png"),
        ("var_fish_01_orange", "prod_fish_01", "6'2", "Sunburst Orange", "Twin Fin", 819.00, 2, "https://res.cloudinary.com/rawsurf/image/upload/v12/fish_orange_overlay.png"),
        ("var_thruster_02_white", "prod_thruster_02", "6'0", "Classic White", "Thruster", 850.00, 5, "https://res.cloudinary.com/rawsurf/image/upload/v12/thruster_white_overlay.png")
    ])
    
    conn.commit()
    conn.close()

seed_test_db()

def test_secure_keys_checking():
    assert woocommerce_mcp_server.WOOCOMMERCE_KEY is not None
    assert woocommerce_mcp_server.WOOCOMMERCE_SECRET is not None
    assert woocommerce_mcp_server.WOOCOMMERCE_KEY.startswith("ck_")
    print("✓ Secure WooCommerce REST API consumer keys verified")

def test_create_product():
    res = woocommerce_mcp_server.wc_create_product(
        seller_id="sel_shaper_01",
        name="Custom Foam Board",
        base_price=350.00,
        description="High volume softboard",
        categories_list=["Softboard", "Beginner"]
    )
    assert "woocommerce_product_id" in res
    assert res["status"] == "pending_admin_approval"
    assert res["base_price"] == 350.00
    print("✓ Product created successfully in WooCommerce cache")

def test_update_product():
    # Update Retro Fish
    res = woocommerce_mcp_server.wc_update_product(
        product_id="prod_fish_01",
        price=829.00,
        description="Newly updated custom twin fin fish.",
        status="approved"
    )
    assert res["success"] is True
    assert res["updates"]["price"] == 829.00
    
    # Check in DB
    conn = sqlite3.connect(woocommerce_mcp_server.DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("SELECT base_price, status FROM marketplace_products WHERE product_id = 'prod_fish_01'")
    row = cursor.fetchone()
    conn.close()
    assert row[0] == 829.00
    assert row[1] == "approved"
    print("✓ Product attributes updated successfully in shaper catalog")

def test_update_variation():
    res = woocommerce_mcp_server.wc_update_variation(
        product_id="prod_fish_01",
        size="6'0\"",
        color="Electric Pink",
        fin_setup="Twin Fin",
        price=839.00,
        stock=3
    )
    assert "variation_id" in res
    assert res["attributes"]["color"] == "Electric Pink"
    assert res["overlay_preview"]["pip_enabled"] is True
    assert "electric_pink" in res["overlay_preview"]["overlay_image_url"]
    print("✓ Custom product variation (size, color, fin setup) and PIP preview generated")

def test_sync_inventory():
    # Sync first variation
    res = woocommerce_mcp_server.wc_sync_inventory(
        product_id="prod_fish_01",
        variation_id="var_fish_01_blue",
        new_quantity=10
    )
    assert res["status"] == "healthy"  # Verify exact structure
    assert res["synchronized_stock_quantity"] == 10
    
    # Check in DB
    conn = sqlite3.connect(woocommerce_mcp_server.DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("SELECT stock_quantity FROM product_variations WHERE variation_id = 'var_fish_01_blue'")
    row = cursor.fetchone()
    conn.close()
    assert row[0] == 10
    print("✓ Inventory levels synchronized cleanly with WooCommerce store")

def test_moderate_listing_success():
    res = woocommerce_mcp_server.wc_moderate_listing("prod_thruster_02", "approve", caller_role="admin")
    assert res["final_marketplace_status"] == "approved"
    assert res["caller_role_verified"] is True
    print("✓ Listing approved successfully by authorized administrator role")

def test_moderate_listing_unauthorized():
    res = woocommerce_mcp_server.wc_moderate_listing("prod_thruster_02", "approve", caller_role="surfer")
    assert res["success"] is False
    assert "Unauthorized" in res["error"]
    print("✓ Moderation request rejected successfully for unauthorized user roles")

def test_attach_gallery_images():
    res = woocommerce_mcp_server.wc_attach_gallery_images(
        product_id="prod_fish_01",
        image_urls=[
            "https://res.cloudinary.com/rawsurf/image/upload/v12/fish_blue_front.png",
            "https://res.cloudinary.com/rawsurf/image/upload/v12/fish_blue_back.png"
        ]
    )
    assert res["total_attached_gallery_images"] == 2
    assert res["attached_images_overlay_configs"][0]["picture_in_picture_enabled"] is True
    print("✓ Cloudinary optimized overlays attached successfully to shaper variation")

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
        woocommerce_mcp_server.main()
        output_str = sys.stdout.getvalue()
    finally:
        sys.stdin = old_stdin
        sys.stdout = old_stdout
        
    response = json.loads(output_str.strip())
    assert response["jsonrpc"] == "2.0"
    assert response["id"] == 1
    assert "capabilities" in response["result"]
    assert response["result"]["serverInfo"]["name"] == "woocommerce-mcp"
    print("✓ JSON-RPC WooCommerce Initialize method returns correct protocol metadata")

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
