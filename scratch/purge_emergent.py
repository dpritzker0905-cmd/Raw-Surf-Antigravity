import os
import re

# File lists and their replacements

replacements = [
    # 1. Replace the customer assets PNG logo with local SVG logo
    (
        "logo.png",
        "/logo.svg"
    ),
    # 2. Replace the preview domains with actual Netlify/Render domains
    (
        "https://dev--rawsurf.netlify.app",
        "https://dev--rawsurf.netlify.app"
    ),
]

# We also have backend URL fallbacks which should point to render backend
backend_replacements = [
    ("os.environ.get('REACT_APP_BACKEND_URL', 'https://dev--rawsurf.netlify.app')", "os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-antigravity.onrender.com')"),
    ("photographer.avatar_url or \"https://dev--rawsurf.netlify.app/api/static/live-status-default.png\"", "photographer.avatar_url or \"https://raw-surf-antigravity.onrender.com/api/static/live-status-default.png\""),
]

target_files = [
    "frontend/src/components/Auth.js",
    "frontend/src/components/Home.js",
    "frontend/src/components/PasswordReset.js",
    "frontend/src/components/PhotographerSubscription.js",
    "frontend/src/components/Sidebar.js",
    "frontend/src/components/SurferSubscription.js",
    "frontend/src/components/TopNav.js",
    "frontend/src/components/WaveLoader.js",
    "backend/scheduler/base.py",
    "backend/routes/auth_pkg/password_reset.py",
    "backend/routes/content/meta_sharing.py",
    "backend/routes/grom_hq/verification.py",
    "backend/routes/photographer/sessions.py",
    "backend/routes/posts/social.py",
    "backend/routes/sessions/join.py",
    "backend/routes/subscriptions_billing/payments.py",
    "backend/scheduler/financial.py",
    "backend/scheduler/grom.py"
]

def purge():
    for rel_path in target_files:
        abs_path = os.path.join(r"c:\Users\dprit\Raw-Surf", rel_path.replace("/", os.sep))
        if not os.path.exists(abs_path):
            print(f"File not found: {abs_path}")
            continue
        
        with open(abs_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
        original_content = content
        
        # Apply standard replacements
        for target, repl in replacements:
            content = content.replace(target, repl)
            
        # Apply backend-specific corrections
        for target, repl in backend_replacements:
            content = content.replace(target, repl)
            
        if content != original_content:
            with open(abs_path, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f"Purged and updated: {rel_path}")
        else:
            print(f"No changes needed: {rel_path}")

if __name__ == "__main__":
    purge()
