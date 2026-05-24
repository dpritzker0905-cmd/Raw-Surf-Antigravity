"""
Test suite for simulation_mcp_server.py
Verifies simulation solvers (perfect waves, storms, database bottlenecks), stress indexes, vulnerability analysis, and JSON-RPC initialize.
"""
import os
import sys
import json
import sqlite3
import pytest
from io import StringIO

# Add backend directory to sys.path to allow importing from simulation_mcp_server
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import simulation_mcp_server

# Initialize database
simulation_mcp_server.init_db()

def seed_test_db():
    conn = sqlite3.connect(simulation_mcp_server.DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM simulated_scenarios")
    conn.commit()
    conn.close()

def test_run_system_simulation_perfect_window():
    seed_test_db()
    
    # 1. Run a perfect surf window scenario under normal conditions
    res = simulation_mcp_server.run_system_simulation(
        name="Malibu Perfect Window Surge Trial",
        user_behavior_preset="booking_surge",
        environmental_preset="perfect_window",
        system_stress_preset="none"
    )
    
    assert res["success"] is True
    eval_data = res["evaluation"]
    
    # Assert perfect window conditions mapped correctly
    assert eval_data["environmental_conditions"]["wave_quality_type"] == "perfect"
    assert eval_data["environmental_conditions"]["swell_height_ft"] == 6.5
    
    # Assert healthy system responses
    assert eval_data["evaluation_result"]["ux_quality_score"] >= 90.0
    assert eval_data["evaluation_result"]["booking_dropoff_rate"] <= 25.0
    
    # Assert dynamic price recommendation recommendations was flagged
    assert any("SURGE_OPTIMIZATION" in s for s in eval_data["optimization_suggestions"])
    
    print("✓ Perfect surf window simulation with dynamic pricing verified successfully")

def test_run_system_simulation_storm_stress():
    seed_test_db()
    
    # 2. Run a heavy storm scenario with high cancellations
    res = simulation_mcp_server.run_system_simulation(
        name="Storm Warning Cancellations Trial",
        user_behavior_preset="heavy_cancellations",
        environmental_preset="storm",
        system_stress_preset="none"
    )
    
    assert res["success"] is True
    eval_data = res["evaluation"]
    
    # Assert storm characteristics
    assert eval_data["environmental_conditions"]["wave_quality_type"] == "storm"
    assert eval_data["environmental_conditions"]["storm_active"] == 1
    
    # Assert high dropoff rates due to unsafe storm conditions
    assert eval_data["evaluation_result"]["booking_dropoff_rate"] >= 50.0
    
    # Assert cancellation and refund suggestions are enqueued
    assert any("CANCELLATIONS" in s for s in eval_data["optimization_suggestions"])
    
    print("✓ Storm cancellations and operator refund loops audited successfully")

def test_run_system_simulation_severe_stress():
    seed_test_db()
    
    # 3. Run high traffic spike paired with severe database latency
    res = simulation_mcp_server.run_system_simulation(
        name="Database Latency Peak Saturation Trial",
        user_behavior_preset="booking_surge",
        environmental_preset="perfect_window",
        system_stress_preset="db_latency_heavy"
    )
    
    assert res["success"] is True
    eval_data = res["evaluation"]
    
    # Assert system bottleneck indicators
    assert eval_data["system_stress"]["db_latency_ms"] == 350.0
    assert eval_data["evaluation_result"]["response_time_ms"] > 350.0
    
    # Assert degraded UX score
    assert eval_data["evaluation_result"]["ux_quality_score"] < 60.0
    
    # Assert database caching suggestions are enqueued
    assert any("DB_LATENCY" in s for s in eval_data["optimization_suggestions"])
    
    print("✓ Database latency bottlenecks and UX degradation indexes verified")

def test_evaluate_stress_vulnerability():
    seed_test_db()
    
    # Seed multiple scenario configurations to compile vulnerability histories
    simulation_mcp_server.run_system_simulation("Trial 1", "booking_surge", "perfect_window", "db_latency_heavy")
    simulation_mcp_server.run_system_simulation("Trial 2", "heavy_map_browsing", "perfect_window", "db_latency_heavy")
    
    vuln = simulation_mcp_server.evaluate_stress_vulnerability()
    
    assert vuln["scenarios_analyzed"] == 2
    assert "Database Latency" in vuln["primary_bottleneck"]
    assert vuln["vulnerability_index"] == "HIGH"
    assert vuln["scaling_priorities"]["database_cache_multiplier"] == 1.5
    
    print("✓ System stress vulnerability bottleneck analysis compiled successfully")

def test_json_rpc_initialize():
    # Simulate a JSON-RPC stdio initialization call
    input_str = json.dumps({
        "jsonrpc": "2.0",
        "id": 501,
        "method": "initialize",
        "params": {}
    }) + "\n"
    
    old_stdin = sys.stdin
    old_stdout = sys.stdout
    sys.stdin = StringIO(input_str)
    sys.stdout = StringIO()
    
    try:
        simulation_mcp_server.main()
        output_str = sys.stdout.getvalue()
    finally:
        sys.stdin = old_stdin
        sys.stdout = old_stdout
        
    response = json.loads(output_str.strip())
    assert response["jsonrpc"] == "2.0"
    assert response["id"] == 501
    assert "capabilities" in response["result"]
    assert response["result"]["serverInfo"]["name"] == "simulation-layer-mcp"
    print("✓ JSON-RPC simulation-layer-mcp Initialize returned correctly")

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
