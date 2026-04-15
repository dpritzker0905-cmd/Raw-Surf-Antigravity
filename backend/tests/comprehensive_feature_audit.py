"""
Comprehensive Feature Audit for Raw Surf OS
Tests all major features across the platform
"""
import asyncio
import httpx
import os
from datetime import datetime

API_URL = os.environ.get("API_URL", "https://raw-surf-os.preview.emergentagent.com/api")

# Test credentials
ADMIN_USER = {
    "email": "dpritzker0905@gmail.com",
    "password": "Test123!"
}

class FeatureAudit:
    def __init__(self):
        self.results = {
            "passed": [],
            "failed": [],
            "warnings": []
        }
        self.admin_token = None
        self.admin_id = None
        
    async def run_all_tests(self):
        """Run all feature tests"""
        async with httpx.AsyncClient(timeout=30.0) as client:
            print("\n" + "="*60)
            print("RAW SURF OS - COMPREHENSIVE FEATURE AUDIT")
            print("="*60)
            print(f"API URL: {API_URL}")
            print(f"Started: {datetime.now().isoformat()}")
            print("="*60 + "\n")
            
            # Authentication & Login
            await self.test_auth(client)
            
            # Core Features
            await self.test_profiles(client)
            await self.test_posts(client)
            await self.test_messages(client)
            await self.test_notifications(client)
            await self.test_bookings(client)
            await self.test_gallery(client)
            
            # Social Features
            await self.test_social(client)
            await self.test_explore(client)
            await self.test_surf_spots(client)
            
            # Photographer Features
            await self.test_photographer(client)
            await self.test_sessions(client)
            
            # Commerce & Payments
            await self.test_credits(client)
            await self.test_gear_hub(client)
            
            # Career & Gamification
            await self.test_career(client)
            await self.test_impact(client)
            await self.test_leaderboard(client)
            
            # Admin Features
            await self.test_admin(client)
            
            # Specialty Features
            await self.test_alerts(client)
            await self.test_grom_hq(client)
            await self.test_username(client)
            await self.test_compliance(client)
            
            # Print Summary
            self.print_summary()
            
    def log_result(self, category, test_name, passed, details=""):
        result = {
            "category": category,
            "test": test_name,
            "details": details
        }
        if passed:
            self.results["passed"].append(result)
            print(f"  ✅ {test_name}")
        else:
            self.results["failed"].append(result)
            print(f"  ❌ {test_name}: {details}")
            
    def log_warning(self, category, test_name, details):
        self.results["warnings"].append({
            "category": category,
            "test": test_name,
            "details": details
        })
        print(f"  ⚠️  {test_name}: {details}")

    async def test_auth(self, client):
        """Test authentication endpoints"""
        print("\n📌 AUTHENTICATION")
        print("-" * 40)
        
        # Login
        try:
            resp = await client.post(f"{API_URL}/auth/login", json=ADMIN_USER)
            if resp.status_code == 200:
                data = resp.json()
                self.admin_id = data.get("id")
                self.log_result("Auth", "Login", True)
            else:
                self.log_result("Auth", "Login", False, f"Status {resp.status_code}")
        except Exception as e:
            self.log_result("Auth", "Login", False, str(e))
            
        # Get current user profile
        try:
            resp = await client.get(f"{API_URL}/profiles/{self.admin_id}")
            self.log_result("Auth", "Get Profile", resp.status_code == 200, 
                          f"Status {resp.status_code}" if resp.status_code != 200 else "")
        except Exception as e:
            self.log_result("Auth", "Get Profile", False, str(e))

    async def test_profiles(self, client):
        """Test profile endpoints"""
        print("\n📌 PROFILES")
        print("-" * 40)
        
        endpoints = [
            ("GET", f"/profiles/{self.admin_id}", "Get Single Profile"),
            ("GET", f"/profiles/{self.admin_id}/stats", "Get Profile Stats"),
            ("GET", f"/profiles/{self.admin_id}/social-stats", "Get Social Stats"),
            ("GET", "/profiles/search?q=test&limit=5", "Search Profiles"),
        ]
        
        for method, endpoint, name in endpoints:
            try:
                if method == "GET":
                    resp = await client.get(f"{API_URL}{endpoint}")
                self.log_result("Profiles", name, resp.status_code in [200, 404])
            except Exception as e:
                self.log_result("Profiles", name, False, str(e))

    async def test_posts(self, client):
        """Test posts/feed endpoints"""
        print("\n📌 POSTS & FEED")
        print("-" * 40)
        
        endpoints = [
            ("GET", "/posts?limit=10", "Get Feed"),
            ("GET", f"/posts/user/{self.admin_id}?limit=5", "Get User Posts"),
            ("GET", "/posts/trending?limit=5", "Get Trending Posts"),
        ]
        
        for method, endpoint, name in endpoints:
            try:
                resp = await client.get(f"{API_URL}{endpoint}")
                self.log_result("Posts", name, resp.status_code == 200,
                              f"Status {resp.status_code}" if resp.status_code != 200 else "")
            except Exception as e:
                self.log_result("Posts", name, False, str(e))
                
        # Get a post ID for further tests
        try:
            resp = await client.get(f"{API_URL}/posts?limit=1")
            if resp.status_code == 200:
                posts = resp.json()
                if posts:
                    post_id = posts[0]["id"]
                    # Test single post
                    resp2 = await client.get(f"{API_URL}/posts/{post_id}")
                    self.log_result("Posts", "Get Single Post", resp2.status_code == 200)
                    # Test comments
                    resp3 = await client.get(f"{API_URL}/posts/{post_id}/comments")
                    self.log_result("Posts", "Get Post Comments", resp3.status_code == 200)
        except Exception as e:
            self.log_result("Posts", "Post Details", False, str(e))

    async def test_messages(self, client):
        """Test messaging endpoints"""
        print("\n📌 MESSAGES")
        print("-" * 40)
        
        endpoints = [
            ("GET", f"/messages/conversations?user_id={self.admin_id}", "Get Conversations"),
            ("GET", f"/notes?user_id={self.admin_id}", "Get Notes"),
        ]
        
        for method, endpoint, name in endpoints:
            try:
                resp = await client.get(f"{API_URL}{endpoint}")
                self.log_result("Messages", name, resp.status_code == 200,
                              f"Status {resp.status_code}" if resp.status_code != 200 else "")
            except Exception as e:
                self.log_result("Messages", name, False, str(e))

    async def test_notifications(self, client):
        """Test notification endpoints"""
        print("\n📌 NOTIFICATIONS")
        print("-" * 40)
        
        try:
            resp = await client.get(f"{API_URL}/notifications?user_id={self.admin_id}")
            self.log_result("Notifications", "Get Notifications", resp.status_code == 200)
        except Exception as e:
            self.log_result("Notifications", "Get Notifications", False, str(e))
            
        try:
            resp = await client.get(f"{API_URL}/notifications/unread-count?user_id={self.admin_id}")
            self.log_result("Notifications", "Get Unread Count", resp.status_code == 200)
        except Exception as e:
            self.log_result("Notifications", "Get Unread Count", False, str(e))

    async def test_bookings(self, client):
        """Test booking endpoints"""
        print("\n📌 BOOKINGS")
        print("-" * 40)
        
        endpoints = [
            ("GET", f"/bookings?user_id={self.admin_id}", "Get User Bookings"),
            ("GET", f"/bookings/photographer?photographer_id={self.admin_id}", "Get Photographer Bookings"),
        ]
        
        for method, endpoint, name in endpoints:
            try:
                resp = await client.get(f"{API_URL}{endpoint}")
                self.log_result("Bookings", name, resp.status_code == 200,
                              f"Status {resp.status_code}" if resp.status_code != 200 else "")
            except Exception as e:
                self.log_result("Bookings", name, False, str(e))

    async def test_gallery(self, client):
        """Test gallery endpoints"""
        print("\n📌 GALLERY")
        print("-" * 40)
        
        endpoints = [
            ("GET", f"/gallery?photographer_id={self.admin_id}", "Get Photographer Gallery"),
            ("GET", f"/surfer-gallery?user_id={self.admin_id}", "Get Surfer Gallery"),
            ("GET", f"/gallery/pricing?user_id={self.admin_id}", "Get Gallery Pricing"),
        ]
        
        for method, endpoint, name in endpoints:
            try:
                resp = await client.get(f"{API_URL}{endpoint}")
                self.log_result("Gallery", name, resp.status_code in [200, 404],
                              f"Status {resp.status_code}" if resp.status_code not in [200, 404] else "")
            except Exception as e:
                self.log_result("Gallery", name, False, str(e))

    async def test_social(self, client):
        """Test social features"""
        print("\n📌 SOCIAL")
        print("-" * 40)
        
        endpoints = [
            ("GET", f"/social/followers/{self.admin_id}", "Get Followers"),
            ("GET", f"/social/following/{self.admin_id}", "Get Following"),
            ("GET", f"/saved-posts?user_id={self.admin_id}", "Get Saved Posts"),
        ]
        
        for method, endpoint, name in endpoints:
            try:
                resp = await client.get(f"{API_URL}{endpoint}")
                self.log_result("Social", name, resp.status_code == 200,
                              f"Status {resp.status_code}" if resp.status_code != 200 else "")
            except Exception as e:
                self.log_result("Social", name, False, str(e))

    async def test_explore(self, client):
        """Test explore endpoints"""
        print("\n📌 EXPLORE")
        print("-" * 40)
        
        try:
            resp = await client.get(f"{API_URL}/explore/feed?limit=10")
            self.log_result("Explore", "Get Explore Feed", resp.status_code == 200)
        except Exception as e:
            self.log_result("Explore", "Get Explore Feed", False, str(e))

    async def test_surf_spots(self, client):
        """Test surf spots endpoints"""
        print("\n📌 SURF SPOTS")
        print("-" * 40)
        
        endpoints = [
            ("GET", "/surf-spots?limit=10", "Get Surf Spots"),
            ("GET", "/surf-spots/trending?limit=5", "Get Trending Spots"),
        ]
        
        for method, endpoint, name in endpoints:
            try:
                resp = await client.get(f"{API_URL}{endpoint}")
                self.log_result("Surf Spots", name, resp.status_code == 200,
                              f"Status {resp.status_code}" if resp.status_code != 200 else "")
            except Exception as e:
                self.log_result("Surf Spots", name, False, str(e))

    async def test_photographer(self, client):
        """Test photographer-specific endpoints"""
        print("\n📌 PHOTOGRAPHER")
        print("-" * 40)
        
        endpoints = [
            ("GET", f"/photographer/on-demand-status?photographer_id={self.admin_id}", "On-Demand Status"),
            ("GET", f"/photographer/earnings?photographer_id={self.admin_id}", "Get Earnings"),
            ("GET", f"/photographer/analytics?photographer_id={self.admin_id}", "Get Analytics"),
        ]
        
        for method, endpoint, name in endpoints:
            try:
                resp = await client.get(f"{API_URL}{endpoint}")
                self.log_result("Photographer", name, resp.status_code in [200, 404],
                              f"Status {resp.status_code}" if resp.status_code not in [200, 404] else "")
            except Exception as e:
                self.log_result("Photographer", name, False, str(e))

    async def test_sessions(self, client):
        """Test session endpoints"""
        print("\n📌 SESSIONS")
        print("-" * 40)
        
        try:
            resp = await client.get(f"{API_URL}/sessions?photographer_id={self.admin_id}")
            self.log_result("Sessions", "Get Photographer Sessions", resp.status_code == 200)
        except Exception as e:
            self.log_result("Sessions", "Get Photographer Sessions", False, str(e))

    async def test_credits(self, client):
        """Test credits/wallet endpoints"""
        print("\n📌 CREDITS & WALLET")
        print("-" * 40)
        
        endpoints = [
            ("GET", f"/credits/balance?user_id={self.admin_id}", "Get Credit Balance"),
            ("GET", f"/credits/transactions?user_id={self.admin_id}", "Get Transactions"),
        ]
        
        for method, endpoint, name in endpoints:
            try:
                resp = await client.get(f"{API_URL}{endpoint}")
                self.log_result("Credits", name, resp.status_code == 200,
                              f"Status {resp.status_code}" if resp.status_code != 200 else "")
            except Exception as e:
                self.log_result("Credits", name, False, str(e))

    async def test_gear_hub(self, client):
        """Test gear hub endpoints"""
        print("\n📌 GEAR HUB")
        print("-" * 40)
        
        try:
            resp = await client.get(f"{API_URL}/gear-hub/products?limit=10")
            self.log_result("Gear Hub", "Get Products", resp.status_code == 200)
        except Exception as e:
            self.log_result("Gear Hub", "Get Products", False, str(e))
            
        try:
            resp = await client.get(f"{API_URL}/surfboards?user_id={self.admin_id}")
            self.log_result("Gear Hub", "Get User Surfboards", resp.status_code == 200)
        except Exception as e:
            self.log_result("Gear Hub", "Get User Surfboards", False, str(e))

    async def test_career(self, client):
        """Test career endpoints"""
        print("\n📌 CAREER")
        print("-" * 40)
        
        endpoints = [
            ("GET", f"/career/stats?user_id={self.admin_id}", "Get Career Stats"),
            ("GET", f"/career/achievements?user_id={self.admin_id}", "Get Achievements"),
        ]
        
        for method, endpoint, name in endpoints:
            try:
                resp = await client.get(f"{API_URL}{endpoint}")
                self.log_result("Career", name, resp.status_code in [200, 404],
                              f"Status {resp.status_code}" if resp.status_code not in [200, 404] else "")
            except Exception as e:
                self.log_result("Career", name, False, str(e))

    async def test_impact(self, client):
        """Test impact dashboard endpoints"""
        print("\n📌 IMPACT")
        print("-" * 40)
        
        try:
            resp = await client.get(f"{API_URL}/impact/dashboard?user_id={self.admin_id}")
            self.log_result("Impact", "Get Impact Dashboard", resp.status_code == 200)
        except Exception as e:
            self.log_result("Impact", "Get Impact Dashboard", False, str(e))
            
        try:
            resp = await client.get(f"{API_URL}/impact/causes")
            self.log_result("Impact", "Get Causes", resp.status_code == 200)
        except Exception as e:
            self.log_result("Impact", "Get Causes", False, str(e))

    async def test_leaderboard(self, client):
        """Test leaderboard endpoints"""
        print("\n📌 LEADERBOARD")
        print("-" * 40)
        
        try:
            resp = await client.get(f"{API_URL}/leaderboard?type=photographers&limit=10")
            self.log_result("Leaderboard", "Get Photographers Leaderboard", resp.status_code == 200)
        except Exception as e:
            self.log_result("Leaderboard", "Get Photographers Leaderboard", False, str(e))

    async def test_admin(self, client):
        """Test admin endpoints"""
        print("\n📌 ADMIN")
        print("-" * 40)
        
        endpoints = [
            ("GET", f"/admin/dashboard?admin_id={self.admin_id}", "Get Admin Dashboard"),
            ("GET", f"/admin/test-accounts?admin_id={self.admin_id}", "Get Test Accounts"),
            ("GET", f"/admin/verification-queue?admin_id={self.admin_id}", "Get Verification Queue"),
        ]
        
        for method, endpoint, name in endpoints:
            try:
                resp = await client.get(f"{API_URL}{endpoint}")
                self.log_result("Admin", name, resp.status_code in [200, 403],
                              f"Status {resp.status_code}" if resp.status_code not in [200, 403] else "")
            except Exception as e:
                self.log_result("Admin", name, False, str(e))

    async def test_alerts(self, client):
        """Test surf alerts endpoints"""
        print("\n📌 SURF ALERTS")
        print("-" * 40)
        
        try:
            resp = await client.get(f"{API_URL}/alerts?user_id={self.admin_id}")
            self.log_result("Alerts", "Get User Alerts", resp.status_code == 200)
        except Exception as e:
            self.log_result("Alerts", "Get User Alerts", False, str(e))

    async def test_grom_hq(self, client):
        """Test Grom HQ endpoints"""
        print("\n📌 GROM HQ")
        print("-" * 40)
        
        try:
            resp = await client.get(f"{API_URL}/grom-hq/linked-groms?parent_id={self.admin_id}")
            self.log_result("Grom HQ", "Get Linked Groms", resp.status_code == 200)
        except Exception as e:
            self.log_result("Grom HQ", "Get Linked Groms", False, str(e))

    async def test_username(self, client):
        """Test username endpoints"""
        print("\n📌 USERNAME")
        print("-" * 40)
        
        try:
            resp = await client.get(f"{API_URL}/username/check/testuser123")
            self.log_result("Username", "Check Username Availability", resp.status_code == 200)
        except Exception as e:
            self.log_result("Username", "Check Username Availability", False, str(e))
            
        try:
            resp = await client.get(f"{API_URL}/username/search?q=test&limit=5")
            self.log_result("Username", "Search Usernames", resp.status_code == 200)
        except Exception as e:
            self.log_result("Username", "Search Usernames", False, str(e))

    async def test_compliance(self, client):
        """Test compliance endpoints"""
        print("\n📌 COMPLIANCE")
        print("-" * 40)
        
        try:
            resp = await client.get(f"{API_URL}/compliance/stats?admin_id={self.admin_id}")
            self.log_result("Compliance", "Get Compliance Stats", resp.status_code in [200, 403])
        except Exception as e:
            self.log_result("Compliance", "Get Compliance Stats", False, str(e))

    def print_summary(self):
        """Print test summary"""
        total = len(self.results["passed"]) + len(self.results["failed"])
        passed = len(self.results["passed"])
        failed = len(self.results["failed"])
        warnings = len(self.results["warnings"])
        
        print("\n" + "="*60)
        print("AUDIT SUMMARY")
        print("="*60)
        print(f"Total Tests: {total}")
        print(f"✅ Passed: {passed} ({(passed/total*100):.1f}%)")
        print(f"❌ Failed: {failed} ({(failed/total*100):.1f}%)")
        print(f"⚠️  Warnings: {warnings}")
        print("="*60)
        
        if self.results["failed"]:
            print("\n❌ FAILED TESTS:")
            for f in self.results["failed"]:
                print(f"  - [{f['category']}] {f['test']}: {f['details']}")
                
        if self.results["warnings"]:
            print("\n⚠️  WARNINGS:")
            for w in self.results["warnings"]:
                print(f"  - [{w['category']}] {w['test']}: {w['details']}")
                
        print("\n" + "="*60)
        
        # Return results as dict for further processing
        return {
            "total": total,
            "passed": passed,
            "failed": failed,
            "warnings": warnings,
            "pass_rate": f"{(passed/total*100):.1f}%",
            "failed_tests": self.results["failed"],
            "warning_tests": self.results["warnings"]
        }


if __name__ == "__main__":
    audit = FeatureAudit()
    asyncio.run(audit.run_all_tests())
