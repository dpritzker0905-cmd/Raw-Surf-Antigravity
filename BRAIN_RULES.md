# 🛡️ SYSTEM SENTINEL: PROTOCOL OVERRIDE
Trigger: Whenever the user inputs the phrase "Follow the rules," you must immediately activate the Brain-Spine-Limb operational state.

Mandatory Compliance Flow:

Stop: Suspend any ongoing autonomous reasoning or speculative tool planning.

Audit: Cross-reference the current request against the Brain (Brand values, #8ec546, creative guidelines) and the Spine (Project architecture, structural constraints).

Validate: Before execution, you must output a brief report in the following format:

BRAIN STATUS: [Check] - Confirmed alignment with core project goals and branding.

SPINE STATUS: [Check] - Confirmed no structural/architectural risk.

LIMB STRATEGY: [Action] - Minimalist tool plan.

Confirm: Ask for explicit "Proceed" consent if the task involves a permanent write-action, database change, or complex refactor.

Violation Policy: If the request conflicts with the Brain or Spine, you are forbidden from executing. Instead, provide a detailed explanation of the conflict and suggest an alternative that adheres to the established project foundation.

---

# Brain Rules — Maximizing MCP Capabilities

This document establishes the **Core MCP Maximize Protocol** for all AI coding assistants, agents, and systems operating on the Raw Surf platform. It defines strict rules to ensure registered Model Context Protocol (MCP) capabilities are prioritized, preserved, and fully leveraged.

---

## ⚡ Core Rules & Directives

### 1. Prefer Registered MCP Servers Over Ad-Hoc Scripts
AI assistants must proactively query and call tools from the active MCP suite before writing scratch scripts or duplicating local logic:
* **Vector Indexing & Searches** $\rightarrow$ Call `vector-db-mcp` (`index_document`, `semantic_search`) to ingest and query surf alerts, weather summaries, and preferences.
* **Pricing & Surge Modeling** $\rightarrow$ Call `dynamic-pricing-mcp` (`calculate_dynamic_price`, `add_admin_override`) to preview booking costs, evaluate availability scarcity, or enforce admin fixed rates.
* **Spatial & Heatmap Analytics** $\rightarrow$ Call `geospatial-analytics-mcp` (`analyze_crowd_density`, `generate_maplibre_geojson`) to snapshot lineup traffic and structure MapLibre GeoJSON layers.
* **Media Optimization & Tagging** $\rightarrow$ Call `cloudinary-mcp` (`optimize_image`, `auto_tag_photo`, `generate_thumbnail`) to compress photos, parse AI metadata, and compile LQIP lazy load assets.
* **Operational Dashboard & Synced Bases** $\rightarrow$ Call `airtable-mcp` (`sync_airtable_with_supabase`, `update_booking_status`, `assign_instructor`, `generate_reports`) to manage leads, trips, and assign instructors with Slack/Email alerts.
* **Recommendation Engine & Dynamic Matching** $\rightarrow$ Call `recommendation-engine-mcp` (`recommend_surf_spots`, `recommend_surf_boards`) to dynamically match surfers to beaches and equipment using multi-factor scores, geographic distance checks, and vector semantic similarity.
* **Geospatial & Mapping Enhancements** $\rightarrow$ Call `google-maps-mcp` (`nearby_surf_spots`, `calculate_travel_time`, `find_nearby_instructors`, `parking_lookup`, `reverse_geocode`, `get_weather_overlay`) to locate beaches/instructors, estimate multi-modal routing, look up parking limits, reverse geocode addresses, and format MapLibre overlay scopes.
* **Workflow Automation & Connection Orchestrations** $\rightarrow$ Call `n8n-mcp` (`create_workflow`, `trigger_workflow`, `get_workflow_executions`, `get_monitoring_dashboard`, `configure_retry_policy`) to design custom newsletter/alerts triggers, coordinate multi-node triggers (Supabase, Stripe, WooCommerce, Twilio, Weather APIs), enforce recovery retry metrics, and monitor visual dashboard states.
* **Financial Checkout & Billing Splits** $\rightarrow$ Call `stripe-mcp` (`create_checkout_session`, `create_subscription`, `refund_payment`, `transfer_payout`, `create_invoice`, `get_customer_payments`, `simulate_webhook`) to construct secure checkout sessions, activate plan memberships, trigger payout disbursements, split coach/photographer commissions (80% to coach, 20% to platform), process refunds, and route webhook events.
* **Marketplace Catalog & Seller Splits** $\rightarrow$ Call `woocommerce-mcp` (`create_product`, `update_product`, `update_variation`, `sync_inventory`, `moderate_listing`, `attach_gallery_images`) to manage surfboard/equipment catalogs, map variable size/color/fin attributes, synchronize stock levels, enforce strict admin moderation queues, and bundle picture-in-picture variation overlays.
* **Google Calendar Scheduling & Booking** $\rightarrow$ Call `google-calendar-mcp` (`check_availability`, `create_booking`, `cancel_booking`, `reschedule_booking`, `get_provider_schedule`) to verify instructor/photographer slots, manage timezone offsets, prevent conflicts, and trigger automated reminders.
* **System Feedback Loop Telemetry** $\rightarrow$ Call `system-feedback-loop-mcp` (`ingest_telemetry_event`, `get_recent_errors`, `get_performance_anomalies`, `get_user_funnel_dropoff`) to stream frontend Netlify and backend Render logs, analyze API latency status anomalies, and retrieve surfer booking dropoff funnel percentages.
* **Autonomous QA Agent Simulators** $\rightarrow$ Call `autonomous-qa-agent-mcp` (`simulate_user_journey`, `get_recent_bug_reports`, `get_system_health_baseline`) to run continuous browser tests simulating bookings or map viewports, log structured bugs prioritized by business impact, and monitor healthy session benchmarks.
* **World Model (Surf + Weather Intel)** $\rightarrow$ Call `world-model-mcp` (`ingest_weather_ocean_data`, `get_surf_spot_insights`, `get_best_surf_spots_24h`, `get_expected_crowds_by_beach`, `get_optimal_photography_windows`, `generate_maplibre_weather_geojson`) to ingest swell/wind/tide stats, calculate derived surf quality scores and crowd probability indexes, output prime golden hour photo timings, correlate cancellations, and format MapLibre GeoJSON weather intelligence layer overlays.
* **Autonomous Operator Engine** $\rightarrow$ Call `autonomous-operator-mcp` (`monitor_system_state`, `propose_pricing_change`, `propose_cancellation`, `execute_decision`, `get_operator_decision_history`) to monitor conditions, enqueue admin-gated pricing revisions, validate safety cancellation thresholds, and maintain audit logs.
* **Persistent Semantic Memory** $\rightarrow$ Call `semantic-memory-mcp` (`store_memory`, `retrieve_similar_memories`, `get_user_preferred_conditions`, `predict_repeat_booking`, `get_surfer_memory_profile`) to index user history, execute time-decayed cosine semantic searches, aggregate surfer preference vectors, and forecast repeat bookings.
* **Real-Time Event Bus** $\rightarrow$ Call `realtime-event-bus-mcp` (`publish_event`, `subscribe_to_channel`, `pull_subscribed_events`, `get_recent_events`, `get_event_bus_metrics`) to ingest core operational event types, handle frontend/AI/notification subscriptions, manage agent mailbox pull queues, and monitor propagation latency metrics.
* **Intelligent Simulation Engine** $\rightarrow$ Call `simulation-layer-mcp` (`run_system_simulation`, `get_simulation_history`, `evaluate_stress_vulnerability`) to model booking surges, cancellations, map browsing, storms, API latency delays, and compile horizontal autoscaling/caching optimization solutions.
* **Web Scraping & Operations** $\rightarrow$ Call `playwright` or `firecrawl-mcp` rather than writing raw headless webdriver code.
* **Episodic Session & Checkpoint Memory** $\rightarrow$ Call `mind` MCP (`checkpoint_query`, `checkpoint_load`, `checkpoint_save`, `checkpoint_done`, `memory_add`, `memory_query`, `space_get`) to recover active checkpoints, persist episodic decisions, and save session progress.
* **Codebase Semantic Graph** $\rightarrow$ Call `trevec` MCP or CLI (`get_context`, `search_code`, `read_file_topology`, `repo_summary`, `neighbor_signatures`, `batch_context`) to retrieve structural codebase context, query functions/classes, and analyze file topology.
* **Keypath Architectural Memory** $\rightarrow$ Call `memstate` MCP (`memstate_remember`, `memstate_get`, `memstate_list`) to save and retrieve structured, versioned keypath architectural facts and stack configuration rules.
* **Supermemory MCP** $\rightarrow$ Persistent memory provider and RAG storage for Claude Desktop and OpenCode.
  * URL: `https://mcp.supermemory.ai/mcp`
  * API Key: `sm_E9Xrnuj9Cmptcm2SQEhjjd_gYLbXcRqWRNQmGxn38rnlLpBEIkozqVsSlIw6fAaZzT0UkudmIR3Oz6HCgWki2lI`
  * Config: Registered manually at `C:\Users\dprit\AppData\Roaming\Claude\claude_desktop_config.json` and in `C:\Users\dprit\.config\opencode\opencode.jsonc`.
* **ChromaDB Vector Store** $\rightarrow$ Vector database for in-memory and client-server prototyping, semantic queries, document tokenization, and embedding indexes.
  * Setup: `chromadb.Client()` (in-memory) or `chroma run --path /chroma_db_path` (client-server).
  * CLI/Packages: `pip install chromadb` (Python), `npm install chromadb` (JS).
  * API Example:
    ```python
    import chromadb
    client = chromadb.Client()
    collection = client.get_or_create_collection("all-my-documents")
    collection.add(documents=["Doc 1", "Doc 2"], ids=["doc1", "doc2"])
    results = collection.query(query_texts=["search term"], n_results=2)
    ```


### 2. Observe and Sync Tool Schemas
When extending models, routes, or database schemas (e.g. `spots.py`, `marketplace.py` in the backend):
* **Audit Alignment**: Instantly verify if the changes impact spatial filters, pricing equations, vector stores, recommendation profiles, geospatial cache, workflow tracking, billing logs, or product variations.
* **Schema Registration**: Update the JSON-RPC schema descriptions and input validations in the corresponding MCP files (`geospatial_mcp_server.py`, `pricing_mcp_server.py`, `recommendation_mcp_server.py`, `google_maps_mcp_server.py`, `n8n_mcp_server.py`, `stripe_mcp_server.py`, `woocommerce_mcp_server.py`, etc.) to keep AI client capabilities cleanly synchronized.

### 3. Native Windows Execution Standarization
To prevent shell escaping failures and quote-stripping issues common to PowerShell/CMD boundaries:
* **Rule**: Never run complex nested JSON objects directly inside bare terminal strings.
* **Standard**: Always wrap command-setting inputs (e.g. `npx openclaw mcp set`) inside a Python `subprocess.run()` list-of-strings pipeline:
  ```python
  import subprocess
  import json
  subprocess.run(["npx", "openclaw", "mcp", "set", "name", json.dumps(payload)], shell=True)
  ```

### 4. Supabase Compatibility Lock
* **pgvector Standards**: All vector index configurations must adhere to Supabase PostgreSQL dimensions (e.g. `vector(384)` for `all-MiniLM-L6-v2`) and use standard HNSW vector cosine operators (`<=>`) to ensure local development migrations compile seamlessly in the cloud production environment.

### 5. Role-Based Moderation Safety
* **Access Control**: Keep standard user permissions isolated. Any MCP tool managing system-wide states (such as deactivating pricing overrides or moderating spam reviews) must strictly enforce that the parameter `caller_role == 'admin'`, rejecting unauthorised surfer/photographer profiles instantly.

### 6. Recommendation Engine Safety & Matching Guidelines
* **Skill Level Verification**: Spot recommendation matches must penalize skill mismatch strictly (e.g. intermediate surfers trying advanced point breaks lose 15 points, beginner surfers trying advanced reef breaks lose 60 points) to guarantee safety.
* **Equipment Profile Matching**: Equipments and surfboards suggestions must match surfer volume expectations: beginners need larger, high-volume boards (minimum 40L) which receive suitability bonuses; advanced surfers need low-volume high-performance thrusters/shortboards (maximum 32L) for maneuverability.

### 7. Google Maps Geospatial Rules
* **Address Resolution**: Proactively reverse geocode spot coordinates to physical formatted addresses to enhance search results readability.
* **Travel and Route Multipliers**: Driving estimates must incorporate standard PCH/traffic friction delay modifiers ($+25\%$) rather than using pure geometric line calculations.
* **MapLibre GL Performance Protection**: Geospatial data must be formatted as raw GeoJSON properties, ensuring seamless integrations with the existing MapLibre web components without blocking UI rendering frames or introducing high latency.

### 8. n8n Workflow Automation Rules
* **Multi-Node Operations**: Automated actions spanning Stripe checkout and WooCommerce orders must be routed through `n8n-mcp` workflow pipelines to guarantee clean step-by-step transaction logs.
* **Failure Recovery Protocol**: All billing and booking flows must enforce active retry policies (minimum 3 attempts) and log detailed failed webhook payloads to SQLite cache repositories to prevent transaction drops.
* **Dashboard Visual Consistency**: Automation dashboard metrics must present clean success/failure curves, ensuring the platform's visual dashboards remain visually consistent and synchronized.

### 9. Stripe Billing & Commission Split Rules
* **Secure Key Fallback**: The server must always support standard environment variables (e.g. `STRIPE_SECRET_KEY`) with robust mock credentials fallback to guarantee stability during automated CI/CD checks.
* **Commission Split Ratios**: All marketplace bookings must strictly enforce standard commission splits (80/20 ratio: 80% earnings to photographers/coaches, 20% platform fee) to preserve commission margins.
* **Supabase Synchronization Hooks**: Webhook handlers for payment success, renewals, and cancellations must propagate metadata updates to local database caches immediately, ensuring user subscription permissions map correctly.

### 10. WooCommerce Marketplace & Variable Product Rules
* **Secure API Credentials**: Connect WooCommerce REST endpoints securely utilizing standard variables (`WOOCOMMERCE_CONSUMER_KEY`, `WOOCOMMERCE_CONSUMER_SECRET`) with robust fallback defaults.
* **Variable Product Attributes**: Variable listings must map classic properties: size, color (e.g. Ocean Blue, Sunburst Orange), and fin setups (Thruster, Twin Fin, Quad, Single Fin).
* **Picture-in-Picture Image Overlays**: Shaper variations must support picture-in-picture overlays, enabling real-time Mockup Canvas previews of customized surfboards.
* **Admin Listing Moderation**: To preserve marketplace safety, listing status updates must be routed through `woocommerce-mcp` moderation and reject unauthorized roles immediately.

### 11. Google Calendar Scheduling Rules
* **Conflict Prevention Inequality**: All scheduling availability checks and booking events must strictly enforce the overlap conflict inequality `(target_start < event_end) and (event_start < target_end)`.
* **Canceled Status Exemption**: Calendar slots associated with `canceled` events must be skipped during overlap checks, allowing instant re-scheduling and slot freeing.
* **ISO 8601 UTC Standardization**: Time ranges must be formatted and stored as standard ISO 8601 strings in UTC (e.g. `'YYYY-MM-DDTHH:MM:SSZ'`) with appropriate local timezone offsets managed transparently.
* **Automated Reminders Notification Logs**: Every confirmed booking must successfully trigger an automated SMS/Email reminder workflow and log details to the SQLite cache to preserve n8n pipeline continuity.
* **SQLite Timeout Resilience**: SQLite database connection timeouts must be set to `10.0` seconds to guarantee thread-safe operation and prevent locks during high-frequency API schedules.

### 12. System Feedback Loop Telemetry Rules
* **Low-Impact Ingestion**: Telemetry logs and behavior metrics must be enqueued asynchronously using non-blocking cycles (`requestIdleCallback` or background worker queues) to prevent UI frame rate drops.
* **Performance Anomaly Thresholds**: Real-time warning alerts must trigger immediately if Map Renderer frame rate drops below $30\text{ FPS}$ or if container memory usage spikes above $512\text{ MB}$.
* **Error Classification Levels**: Critical errors and fatal logs (`level in ('error', 'fatal')` or HTTP status $\ge 500$) must trigger real-time slack/webhook regression alerts immediately.
* **Conversion Funnel Integrity**: Funnel conversion and dropoff percentages must strictly trace matching surfer session transitions from `booking_started` to `booking_completed` to guarantee conversion audit accuracy.

### 13. Autonomous QA Agent Rules
* **Continuous Journey Simulations**: Autonomous QA audits must simulate real surfers traversing core funnels (`booking_lesson`, `map_browsing`, `forecast_checking`, `marketplace_listing`) to capture real-time exceptions.
* **Business-Impact Prioritization**: Generated bugs must be prioritized using strict severity weights: critical bookings failures are High severity; map rendering lags or forecast unresponsive views are Medium severity; marketplace catalog listing issues are Low severity.
* **Layout and Error Auditing**: Simulators must dynamically capture layout misfits, JS trace exceptions, and rendering latencies, outputting structured reports alongside detailed screenshot paths.
* **Baseline Health Comparisons**: System health baseline metrics must compare simulated conversion success ratios against the target bench percentage ($95.0\%$), immediately flagging degraded system statuses.

### 14. World Model MCP Guidelines
* **Surf Quality Formula**: Surf quality scores ($0\text{-}100$) must be evaluated dynamically by swell height ($3\text{-}8\text{ ft}$ optimal), swell period ($\ge 12\text{s}$ optimal), offshore winds (bonus $+15$), onshore winds (penalty $-25$), and tide cycles (rising/low bonus $+10$).
* **Crowd Probability Metrics**: Crowd indices ('low', 'medium', 'high') must be predicted dynamically as a function of surf quality, swell warmness, and simulated local active bookings.
* **Optimal Photography Windows**: Photography suitability windows must map Golden Hour morning ($06:00\text{-}08:30$) and evening ($17:30\text{-}19:30$) timings, strictly enforcing that they are PRIME only when offshore winds and waves $\ge 3\text{ ft}$ groom glassy shapes.
* **MapLibre Layer GeoJSON**: Ingested weather overlays must be exported as standard MapLibre GeoJSON coordinates containing derived quality scores and orange-red ($q \ge 70.0$) or blue-light hex marker properties.

### 15. Autonomous Operator Rules
* **Strict Admin Approval Gates**: Proposing any dynamic pricing adjustments enqueues them in `pending_approval` state, and executing them strictly requires `caller_role == 'admin'`, rejecting any moderator or standard user attempts immediately.
* **Safety Threshold Cancellations**: Booking cancellations require validation against ocean safety thresholds: they are validated and enqueued only when swell height $> 10\text{ ft}$, matching the World Model weather caches.
* **Decision Trail Auditing**: Every system state monitor recommendation and operational proposal must write detailed explanation logs into the SQLite caching DB to preserve full accountability.
* **Stripe, Supabase, and Google Calendar Sync**: Executed operator decisions must trigger synchronized updates showing successful payment status transitions in Stripe checkout, scheduling slot updates in Google Calendar, and telemetry audit records in Supabase.

### 16. Persistent Semantic Memory Rules
* **Privacy-Safe Partitioning**: Every single semantic indexing and retrieval operation must strictly demand and filter by a unique `user_id`. Under no circumstances should cross-user semantic memory queries be allowed to run, protecting private surfer data.
* **Time-Based Exponential Decay**: Semantic retrieval results must apply active time decay weighting $\lambda = 0.05$ (meaning a half-life of roughly 14 days) to ensure recent sessions and waves conditions matter more than older historical sessions:
  $$\text{score} = \text{cosine\_similarity} \cdot e^{-\lambda \cdot \Delta t}$$
* **Recommendation Preference Aggregation**: Memory profile retrievals must normalize time-decayed vectors to provide the `recommendation-engine-mcp` with accurate 384-dimensional surfer preference representations.
* **Booking Forecast Heuristics**: Repeat booking prediction scores must factor booking frequencies, recency bonuses, and positive sentiment metadata ratios, outputting a probability rate between 0% and 100%.

### 17. Real-Time Event Bus Rules
* **Low-Latency Propagation**: Propagated events must route to subscribers in under $500\text{ms}$ (aiming for $<10\text{ms}$ locally) to preserve real-time UI/UX sync and instant alert dispatches.
* **Autotrigger Alerting**: Weather updates containing swell height $> 10\text{ ft}$ must automatically publish an secondary `swell_threshold_crossed` safety alert event to trigger immediate downstream cancellation routines.
* **Robust Mailbox Pull Queues**: Pull-based agent subscribers must successfully pull unread enqueued events via `pull_subscribed_events(subscription_id)` and automatically transition states to `read` to avoid duplicate processing loops.
* **Persistent Telemetry Auditing**: Core event categories (`bookings_created`, `weather_updated`, `swell_threshold_crossed`, `user_checked_map`, `payment_success`) must be written to `event_bus.db` for full telemetry auditing.

### 18. Simulation Layer Rules
* **Behavior, Weather, and Stress Presets**: Scenario runs must strictly map predefined presets (user patterns: `booking_surge`, `heavy_cancellations`, `heavy_map_browsing`; environmental: `storm`, `flat_spell`, `perfect_window`; stress: `api_failures_high`, `db_latency_heavy`, `traffic_spike_mega`) to maintain evaluation consistency.
* **Derived System Metrics Calculations**: Evaluated metrics must dynamically compute response times (base 80ms + latency offsets), UX quality scores (penalized by failures, latency and storm warning indicators), and booking dropoffs.
* **Automated Scaling Logic**: The simulator must automatically output optimization recommendations when thresholds are breached (e.g. suggesting database cache structures for DB latency $> 200\text{ ms}$, gateway rate limits for traffic spikes $> 5000\text{ RPM}$, circuit breakers for API failures $> 15\%$).
* **Trend Analysis Bottleneck Discovery**: Vulnerability trends must aggregate Historic trial entries to correctly highlight database reads, external gateways, or safety cancellation hooks as the primary platform scaling vulnerabilities.

### 19. Event Spine Rules
* **Unified Event Spine Core**: The Central Event Spine is the ONLY permitted communication medium between MCP servers. Direct cross-service dependencies or mutable shared state are strictly forbidden.
* **Causal Trace Tracking**: Every published event must accept and propagate a `correlation_id` to trace transactional lifecycles across booking, weather, behavior, and QA workflows.
* **Event Replayability**: All events must support time-range filtering (`replay_events`) using ISO 8601 UTC Z timestamps to reconstruct historical state sequences.
* **Real-time Pub/Sub Streaming**: Event dispatches must broadcast in real-time to active listeners, maintaining low latency propagation (<500ms) with zero-coupling between producers and consumers.

### 20. Debug Consciousness Rules
* **Pure Diagnostic Observation**: The Debug Consciousness Layer (DCL) must remain strictly read-only and analytics-only. It is forbidden from modifying production database states, bookings, payments, or executing workflows.
* **Causal Failure Diagnosis**: Every root-cause failure analysis (`explain_failure`) must trace causality backward through correlation chains and return the mandated format (Root Cause Summary, First failing MCP, First failing event, Full event chain leading to failure, Suggested fix, and Confidence score).
* **Dynamic Health Index Calculations**: The System Health Score ($0\text{-}100$) must be evaluated dynamically based on recent event logs, applying strict penalties for hard failures ($-15$ per error event), broken event chains ($-10$ per incomplete flow), and latency anomalies ($-5$ per propagation step $>500\text{ ms}$).
* **Debug Memory Persistence**: Diagnosed root causes and anomalous traces must be committed to the isolated `debug_consciousness.db` failure logs to allow historical regression tracking and recurring pattern discoveries.

### 21. Unified Memory & Codebase Context Rules (Mind, Trevec, Memstate)
* **Recover (Session Start)**: You must check for active checkpoints using `checkpoint_query` first thing on startup, and load the correct checkpoint using `checkpoint_load` to instantly restore context.
  * **Memory Ingestion Checklist**: Ensure the following newly installed local memory architectures are fully initialized and checked:
    1. **codebase-memory-mcp** (high-performance local SQLite codebase knowledge graph with `auto_index = true` watcher) & **Trevec CLI** (local structural codebase graph).
    2. **Mind MCP Server** (Bun run stdio).
    3. **treesitter-mcp** (Code Analysis parsing server: `treesitter_analyze_file`, `treesitter_get_ast`).
    3. **docker-mcp gateway** (running under `--profile ai_coding`).
    4. **Memgraph Platform** (MAGE graph analytics: `c:\Users\dprit\Raw-Surf\memgraph-platform`).
    5. **Qdrant Vector Cluster** (AWS-hosted semantic search: `tools/qdrant-vector-db`).
    6. **LangSmith Tracing** (smith.langchain.com LLM logs: `tools/langsmith-tracing`).
    7. **DuckDB Embedded OLAP** (in-process SQL analytics engine: `tools/duckdb`).
    8. **SpectorJS WebGL Debugger** (visual graphics inspector for MapLibre GPU: `tools/spectorjs`).
    9. **React Scan Profiler** (Million.js React re-render scan optimization: `tools/react-scan`).
    10. **PyArrow Memory Columnar** (high-performance columnar in-memory data structures: `tools/pyarrow`).
    11. **VEKTOR Slipstream** (MAGMA 4-layer associative graph memory, sub-8ms local ONNX/SQLite HNSW recall).
    12. **AI Vision MCP** (High-fidelity design/vision audit server for real-time visual grounding, accessibility compliance, and object detection).
* **Orient (Retrieve Context)**: Proactively call `get_context` or `search_code` (Trevec) to retrieve relevant file locations, dependency graphs, and structural context before reading raw files. Run `read_file_topology` before editing any file to inspect existing imports and function boundaries.
* **AST & Code Parsing Tools**: Proactively utilize the `treesitter-mcp` CLI/server (installed at `C:\Users\dprit\AppData\Roaming\Python\Python314\Scripts\treesitter-mcp.exe`) to execute deep tree-sitter based analysis (`treesitter_analyze_file`, `treesitter_get_ast`) when doing granular syntax audits or dependency extractions.
* **Docker & Graph Platforms**: Leverage the active `docker-mcp` gateway running under the `ai_coding` profile for containerized environment context. When graph-based visual queries or MAGE modeling are required, Memgraph Platform files are pre-staged in `c:\Users\dprit\Raw-Surf\memgraph-platform` (ports: Bolt `7687`, Lab `3000`). If WSL Service throws error code `Wsl/0x80070422`, ensure `WslService` startup type is flipped from `Disabled` to `Manual`/`Automatic`.
* **Qdrant Vector Database**: Connect to the hosted Qdrant Cloud Cluster using the endpoint URL `https://6c70bac3-ef81-4d4f-a0f8-ad53e8f5b266.eu-west-2-0.aws.cloud.qdrant.io:6333` and its API Key `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3MiOiJtIiwic3ViamVjdCI6ImFwaS1rZXk6M2M1YjhkMGItMDljZC00ZWUyLWIyNjctYTRhYjZkNjZjMzBjIn0.BGHeTiVRZURsixjp82bOAQ_NuWhQa4Mtq-xrvkEuJag` (verified success v1.18.1) for indexing, cosine similarities, decay scoring, and surfer preference queries.
* **LangSmith LLM Tracing**: Trace and monitor LLM calls, chain runs, and operational trace points on `smith.langchain.com` (active v0.8.5). The LangSmith API Key is securely stored in **Mind episodic memory (`tools/langsmith-tracing`)**; retrieve it semantic-first to set environment variables (`LANGSMITH_API_KEY`, `LANGSMITH_TRACING="true"`) when running automated telemetry or diagnostic flows.
* **VEKTOR Slipstream**: Leverage the local MAGMA 4-layer associative memory (semantic · causal · temporal · entity) for sub-8ms high-performance agent contextual recall. Ensure the license activation is persistent, and invoke the local server whenever context synthesis or long-term associative memory indexing is required.
* **AI Vision MCP**: Proactively call the local vision MCP server (`ai-vision-mcp`) to perform high-resolution visual audits, verify CSS/WebGL layout fidelity, run accessibility compliance, and analyze screen diagnostics directly within the selected browser dev page.
* **Persist & Save**: Periodically capture non-obvious details, architectural choices, and bugs using `memory_add` (Mind) with proper category tags (e.g. `cat:decision`, `cat:bugfix`, `cat:preference`) and `checkpoint_save`. Link related memories using `links_to` or `link_create` for deep relational recovery.
* **Teardown (Session End)**: Always commit completed work summaries by calling `checkpoint_done` to serialize episodic session history before terminating the agent execution.
* **Architecture Consistency**: Synchronize key stack decisions and constraints via `memstate_remember` to prevent repeated exploration of technology boundaries.
* **Strict Anti-Patterns**:
  - **NEVER** do significant work without an active checkpoint in **Mind**.
  - **NEVER** let a session end without calling `checkpoint_done` to log a session summary.
  - **NEVER** create a Mind memory without at least one tag (e.g. `cat:decision`).
  - **ALWAYS** check file topology (`read_file_topology`) before editing a file.
  - **NEVER** stage, commit, or push changes directly to the `main` production branch. All updates, fixes, and rules modifications must be pushed exclusively to the `dev` branch.

### 22. Git Branching & Deployment Constraints
* **Exclusive Dev Branch Target**: AI assistants are strictly forbidden from staging, committing, or pushing any codebase modifications directly to the `main` branch. All branch targets for git push operations must be explicitly set to `dev` (`git push origin dev`).
* **Dev Environment Targeting**: All production build verifications, local Netlify previews, and local server actions must explicitly target the `dev` environment or branch state. The `main` branch remains locked for manual gatekeeper verification and staging release controls.

---

> [!IMPORTANT]
> The MCP Maximize Protocol operates as a primary system binding. AI assistants must always inspect this rules checklist on each turn to preserve clean agent capabilities.

---

## 🌊 Weather Simulation System Features & Rules

When working on weather simulation system features, follow these rules, tools, and documentation protocols:

### ⚙️ Operating Rule
> [!IMPORTANT]
> **Do not rewrite the system.** First map the data pipeline, compare current code to stable commits, add logs, identify the exact mismatch, then make the smallest targeted fix.

### 🛠️ Required MCP Servers & Tools
1. **Context7 MCP**: For retrieving current documentation and API references.
2. **GitHub MCP**: For commit history, diffs, regression archaeology.
3. **Playwright MCP**: For opening the app, clicking around, and inspecting visual behavior.
4. **Chrome DevTools MCP**: For inspecting console logs, network events, performance traces, and memory/RAF issues.
5. **Sequential Thinking MCP**: For forcing step-by-step root-cause analysis.
6. **Filesystem MCP**: For reading/write local project files safely.
7. **Memory MCP**: For storing stable architecture rules, known regressions, and "do not touch" zones.

### 🔍 Specialized Debugging Tools
* **Spector.js**: Inspect WebGL draw calls, textures, framebuffers, shaders, and uniforms.
* **Chrome Performance Profiler**: Analyze animation timing, render thrashing, and frame drops.
* **React DevTools**: Inspect state ownership, stale props, and re-render loops.
* **Network Inspector**: Analyze backend payload shape, forecast frame loading, and cache issues.

### 📚 Reference Documentation (Load via Context7)
* **Mapbox GL JS docs**
* **MapLibre GL JS docs** (if applicable)
* **deck.gl docs** (if used)
* **WebGL Fundamentals**
* **MDN Canvas/WebGL docs**
* **Open-Meteo API docs**
* **NOAA/NCEP NOMADS docs**
* **ECMWF forecast documentation**
* **GDAL geospatial/raster docs**
* **proj4 / projection docs**
* **Turf.js docs** (if used)
* **React docs**
* **Vite docs** (if used)
* **Netlify/serverless docs** (if backend is deployed there)

### 📂 Project-Specific Files & Assets to Load
* **All heatmap rendering files** (e.g., `WebGLMarineLayer.js`, shaders, etc.)
* **Forecast backend API routes** (e.g., `viewport_service.py`, `scheduler.py`, etc.)
* **Field normalization utilities** (e.g., `normalizer.py`, etc.)
* **Animation/timeline controller files**
* **Info box / forecast sampling components**
* **Map layer composer files** (e.g., `useMarineOrchestrator.js`, etc.)
* **Model selector/state files**
* **Cache/service worker files**
* **Previous stable commits**: Focus on `b5bbaa7d` and `f5f6a3d` to audit changes.
* **Regression archaeology**: Any regression notes, logs, or "archaeology" artifacts already in the repo.

### 📊 Weather Simulation Diagnostics & HUD Rules
* **Unified Diagnostics HUD (`TruthOverlay.js`)**: All client-side diagnostics (Truth Inspector, Events Trace logs, WebGL shader debug view toggles, and GPU/FCE Telemetry) must be integrated into this single tabbed HUD panel. Do not create separate floating debug panels.
* **Events Trace Logging**: Any new weather event types (requests, loaded files, timeouts, fallbacks) must be routed to `WeatherTelemetry` in the frontend so they are visible in the HUD events log.
* **Remote Violations Reporting**: When a critical layer violation or WebGL failure is detected by the client-side `useLayerTruthDiff` or HUD, it must be reported to the backend endpoint `POST /api/weather/client-diagnostics` for centralized server logging.
* **Throttling Constraint**: Client-side reporting to the backend must be throttled to a minimum of 60 seconds per unique violation type to prevent flooding the server during rapid map rendering loops.




