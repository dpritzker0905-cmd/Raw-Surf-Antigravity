"""
Admin Pricing Configuration API
God Mode - Real-time pricing editor
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone
import logging

from database import get_db
from models import Profile, GlobalPricingConfig

router = APIRouter()
logger = logging.getLogger(__name__)

# ============================================================
# DEFAULT PRICING DATA - SINGLE SOURCE OF TRUTH
# This is the initial seed data and fallback if no DB config exists
# WHOLE DOLLAR PRICING - 1 Credit = $1.00 (1:1 RATIO)
# ============================================================

DEFAULT_PRICING_DATA = {
    "surfer": {
        "role_label": "Surfer",
        "tiers": {
            "tier_1": {
                "id": "surfer_free",
                "name": "Free",
                "price": 0,
                "features": ["Profile & social features", "Book photo sessions", "5GB storage", "Ad-supported"]
            },
            "tier_2": {
                "id": "surfer_basic",
                "name": "Basic",
                "price": 5,
                "features": ["Ad-free experience", "50GB storage", "20% commission", "10% session discount"]
            },
            "tier_3": {
                "id": "surfer_premium",
                "name": "Premium",
                "price": 10,
                "features": ["Unlimited storage", "15% commission", "Gold-Pass 2hr booking", "20% session discount"]
            }
        }
    },
    "grom": {
        "role_label": "Grom",
        "tiers": {
            "tier_1": {
                "id": "grom_free",
                "name": "Free",
                "price": 0,
                "features": ["Profile & social (parent-approved)", "View tagged photos", "5GB storage", "Ad-supported"]
            },
            "tier_2": {
                "id": "grom_basic",
                "name": "Basic",
                "price": 3,
                "features": ["Ad-free experience", "25GB storage", "Competition tracking", "Grom Leaderboard"]
            },
            "tier_3": {
                "id": "grom_premium",
                "name": "Premium",
                "price": 8,
                "features": ["Unlimited storage", "Priority events", "Featured in Grom Rising", "Sponsor visibility"]
            }
        }
    },
    "photographer": {
        "role_label": "Photographer",
        "tiers": {
            "tier_2": {
                "id": "photographer_basic",
                "name": "Basic",
                "price": 18,
                "features": ["Unlimited storage", "20% commission", "Track surfers 5mi", "Set your prices"]
            },
            "tier_3": {
                "id": "photographer_premium",
                "name": "Premium",
                "price": 30,
                "features": ["15% commission", "Track surfers worldwide", "50 free AI credits/mo", "Priority placement"]
            }
        }
    },
    "grom_parent": {
        "role_label": "Grom Parent",
        "tiers": {
            "tier_1": {
                "id": "grom_parent_free",
                "name": "Free",
                "price": 0,
                "features": ["Grom management dashboard", "Link & monitor Groms", "Book sessions", "Ad-supported"]
            },
            "tier_2": {
                "id": "grom_parent_basic",
                "name": "Basic",
                "price": 5,
                "features": ["Ad-free experience", "Priority notifications", "Grom progress reports"]
            },
            "tier_3": {
                "id": "grom_parent_premium",
                "name": "Premium",
                "price": 10,
                "features": ["Gold-Pass 2hr booking", "Surfer Hybrid mode", "Advanced analytics", "Priority support"]
            }
        }
    },
    "hobbyist": {
        "role_label": "Hobbyist",
        "tiers": {
            "tier_1": {
                "id": "hobbyist_free",
                "name": "Free",
                "price": 0,
                "features": ["Upload & share photos", "Gear Credits earnings", "Support Groms & Causes", "Ad-supported"]
            },
            "tier_2": {
                "id": "hobbyist_basic",
                "name": "Basic",
                "price": 5,
                "features": ["Ad-free experience", "Priority in local searches", "Gear Credits earnings"]
            }
        }
    },
    "comp_surfer": {
        "role_label": "Competition Surfer",
        "tiers": {
            "tier_1": {
                "id": "comp_surfer_free",
                "name": "Free",
                "price": 0,
                "features": ["Profile & social features", "Competition tracking", "5GB storage", "Ad-supported"]
            },
            "tier_2": {
                "id": "comp_surfer_basic",
                "name": "Basic",
                "price": 8,
                "features": ["Ad-free experience", "50GB storage", "Leaderboard visibility", "Heat analysis"]
            },
            "tier_3": {
                "id": "comp_surfer_premium",
                "name": "Premium",
                "price": 15,
                "features": ["Unlimited storage", "Priority event access", "Sponsor connections", "Advanced stats"]
            }
        }
    },
    "pro_surfer": {
        "role_label": "Pro Surfer",
        "tiers": {
            "tier_2": {
                "id": "pro_surfer_basic",
                "name": "Basic",
                "price": 0,
                "features": ["Verified badge", "Pro Lounge access", "Priority placement", "50GB storage"]
            },
            "tier_3": {
                "id": "pro_surfer_premium",
                "name": "Premium",
                "price": 20,
                "features": ["Unlimited storage", "Sponsor dashboard", "Revenue sharing", "VIP support"]
            }
        }
    },
    "approved_pro_photographer": {
        "role_label": "Verified Pro Photographer",
        "tiers": {
            "tier_2": {
                "id": "approved_pro_basic",
                "name": "Basic",
                "price": 25,
                "features": ["Verified badge", "12% commission", "Priority in searches", "Unlimited storage"]
            },
            "tier_3": {
                "id": "approved_pro_premium",
                "name": "Premium",
                "price": 50,
                "features": ["10% commission", "Featured placement", "100 AI credits/mo", "Priority support"]
            }
        }
    },
    "surf_school": {
        "role_label": "Surf School / Coach",
        "tiers": {
            "tier_2": {
                "id": "surf_school_basic",
                "name": "Basic",
                "price": 30,
                "features": ["Business profile", "Booking management", "Student tracking", "20% commission"]
            },
            "tier_3": {
                "id": "surf_school_premium",
                "name": "Premium",
                "price": 60,
                "features": ["15% commission", "Multi-instructor support", "Branded booking page", "Priority placement"]
            }
        }
    },
    "shop": {
        "role_label": "Surf Shop",
        "tiers": {
            "tier_2": {
                "id": "shop_basic",
                "name": "Basic",
                "price": 40,
                "features": ["Business profile", "Product listings", "Local visibility", "20% commission"]
            },
            "tier_3": {
                "id": "shop_premium",
                "name": "Premium",
                "price": 80,
                "features": ["15% commission", "Featured products", "Inventory management", "Analytics dashboard"]
            }
        }
    },
    "shaper": {
        "role_label": "Shaper",
        "tiers": {
            "tier_2": {
                "id": "shaper_basic",
                "name": "Basic",
                "price": 25,
                "features": ["Portfolio showcase", "Custom board orders", "Local visibility", "20% commission"]
            },
            "tier_3": {
                "id": "shaper_premium",
                "name": "Premium",
                "price": 50,
                "features": ["15% commission", "Featured in searches", "Order management", "Customer reviews"]
            }
        }
    },
    "resort": {
        "role_label": "Resort / Retreat",
        "tiers": {
            "tier_2": {
                "id": "resort_basic",
                "name": "Basic",
                "price": 100,
                "features": ["Business profile", "Booking integration", "Photo galleries", "20% commission"]
            },
            "tier_3": {
                "id": "resort_premium",
                "name": "Premium",
                "price": 200,
                "features": ["15% commission", "Featured placement", "Travel packages", "Concierge support"]
            }
        }
    },
    "wave_pool": {
        "role_label": "Wave Pool",
        "tiers": {
            "tier_2": {
                "id": "wave_pool_basic",
                "name": "Basic",
                "price": 150,
                "features": ["Facility profile", "Session bookings", "Wave conditions API", "20% commission"]
            },
            "tier_3": {
                "id": "wave_pool_premium",
                "name": "Premium",
                "price": 300,
                "features": ["15% commission", "Priority in app", "Event hosting", "Analytics suite"]
            }
        }
    },
    "destination": {
        "role_label": "Surf Destination",
        "tiers": {
            "tier_2": {
                "id": "destination_basic",
                "name": "Basic",
                "price": 75,
                "features": ["Destination profile", "Local businesses", "Travel guides", "20% commission"]
            },
            "tier_3": {
                "id": "destination_premium",
                "name": "Premium",
                "price": 150,
                "features": ["15% commission", "Featured destination", "Partnership tools", "Tourism analytics"]
            }
        }
    }
}


class PricingTierUpdate(BaseModel):
    name: Optional[str] = None
    price: Optional[int] = None  # WHOLE DOLLARS ONLY
    features: Optional[List[str]] = None


class PricingRoleUpdate(BaseModel):
    role_label: Optional[str] = None
    tiers: Optional[Dict[str, PricingTierUpdate]] = None


class PricingConfigUpdate(BaseModel):
    surfer: Optional[PricingRoleUpdate] = None
    grom: Optional[PricingRoleUpdate] = None
    photographer: Optional[PricingRoleUpdate] = None
    grom_parent: Optional[PricingRoleUpdate] = None
    hobbyist: Optional[PricingRoleUpdate] = None
    comp_surfer: Optional[PricingRoleUpdate] = None
    pro_surfer: Optional[PricingRoleUpdate] = None
    approved_pro_photographer: Optional[PricingRoleUpdate] = None
    surf_school: Optional[PricingRoleUpdate] = None
    shop: Optional[PricingRoleUpdate] = None
    shaper: Optional[PricingRoleUpdate] = None
    resort: Optional[PricingRoleUpdate] = None
    wave_pool: Optional[PricingRoleUpdate] = None
    destination: Optional[PricingRoleUpdate] = None


async def get_active_pricing_config(db: AsyncSession) -> Dict[str, Any]:
    """Get the active pricing configuration from DB or return default"""
    result = await db.execute(
        select(GlobalPricingConfig)
        .where(GlobalPricingConfig.is_active == True)
        .order_by(GlobalPricingConfig.version.desc())
        .limit(1)
    )
    config = result.scalar_one_or_none()
    
    if config:
        return config.pricing_data
    
    # Return default if no DB config exists
    return DEFAULT_PRICING_DATA


@router.get("/subscriptions/config")
async def get_pricing_config(db: AsyncSession = Depends(get_db)):
    """
    Public endpoint to get current pricing configuration
    Used by frontend to dynamically load prices for Signup/Settings
    """
    pricing_data = await get_active_pricing_config(db)
    
    return {
        "pricing": pricing_data,
        "credit_rate": 1,  # 1 credit = $1.00
        "currency": "USD"
    }


@router.get("/admin/pricing/config")
async def admin_get_pricing_config(
    admin_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Admin endpoint to get full pricing config with metadata"""
    # Verify admin
    result = await db.execute(select(Profile).where(Profile.id == admin_id))
    admin = result.scalar_one_or_none()
    if not admin or not admin.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Get active config
    config_result = await db.execute(
        select(GlobalPricingConfig)
        .where(GlobalPricingConfig.is_active == True)
        .order_by(GlobalPricingConfig.version.desc())
        .limit(1)
    )
    config = config_result.scalar_one_or_none()
    
    if config:
        return {
            "pricing": config.pricing_data,
            "version": config.version,
            "updated_at": config.updated_at.isoformat() if config.updated_at else None,
            "updated_by": config.updated_by,
            "is_from_db": True
        }
    
    return {
        "pricing": DEFAULT_PRICING_DATA,
        "version": 0,
        "updated_at": None,
        "updated_by": None,
        "is_from_db": False
    }


@router.post("/admin/pricing/update")
async def admin_update_pricing_config(
    admin_id: str,
    data: PricingConfigUpdate,
    db: AsyncSession = Depends(get_db)
):
    """
    Admin endpoint to update pricing configuration
    Creates a new versioned config entry
    """
    # Verify admin
    result = await db.execute(select(Profile).where(Profile.id == admin_id))
    admin = result.scalar_one_or_none()
    if not admin or not admin.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Get current config
    current_pricing = await get_active_pricing_config(db)
    
    # Deep merge updates
    updated_pricing = current_pricing.copy()
    update_dict = data.dict(exclude_none=True)
    
    for role_key, role_updates in update_dict.items():
        if role_key not in updated_pricing:
            continue
        
        if isinstance(role_updates, dict):
            if 'role_label' in role_updates:
                updated_pricing[role_key]['role_label'] = role_updates['role_label']
            
            if 'tiers' in role_updates and role_updates['tiers']:
                for tier_key, tier_updates in role_updates['tiers'].items():
                    if tier_key in updated_pricing[role_key]['tiers']:
                        for field, value in tier_updates.items():
                            if value is not None:
                                updated_pricing[role_key]['tiers'][tier_key][field] = value
    
    # Deactivate old configs
    old_configs = await db.execute(
        select(GlobalPricingConfig).where(GlobalPricingConfig.is_active == True)
    )
    for old_config in old_configs.scalars().all():
        old_config.is_active = False
    
    # Get latest version
    latest_result = await db.execute(
        select(GlobalPricingConfig).order_by(GlobalPricingConfig.version.desc()).limit(1)
    )
    latest = latest_result.scalar_one_or_none()
    new_version = (latest.version + 1) if latest else 1
    
    # Create new config
    new_config = GlobalPricingConfig(
        pricing_data=updated_pricing,
        version=new_version,
        updated_by=admin_id,
        updated_at=datetime.now(timezone.utc),
        is_active=True
    )
    db.add(new_config)
    await db.commit()
    
    logger.info(f"Pricing config updated to v{new_version} by admin {admin_id}")
    
    return {
        "success": True,
        "message": f"Pricing updated to version {new_version}",
        "version": new_version,
        "pricing": updated_pricing
    }


@router.post("/admin/pricing/reset")
async def admin_reset_pricing_config(
    admin_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Reset pricing to default values"""
    # Verify admin
    result = await db.execute(select(Profile).where(Profile.id == admin_id))
    admin = result.scalar_one_or_none()
    if not admin or not admin.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Deactivate old configs
    old_configs = await db.execute(
        select(GlobalPricingConfig).where(GlobalPricingConfig.is_active == True)
    )
    for old_config in old_configs.scalars().all():
        old_config.is_active = False
    
    # Get latest version
    latest_result = await db.execute(
        select(GlobalPricingConfig).order_by(GlobalPricingConfig.version.desc()).limit(1)
    )
    latest = latest_result.scalar_one_or_none()
    new_version = (latest.version + 1) if latest else 1
    
    # Create new config with defaults
    new_config = GlobalPricingConfig(
        pricing_data=DEFAULT_PRICING_DATA,
        version=new_version,
        updated_by=admin_id,
        updated_at=datetime.now(timezone.utc),
        is_active=True
    )
    db.add(new_config)
    await db.commit()
    
    logger.info(f"Pricing config reset to defaults (v{new_version}) by admin {admin_id}")
    
    return {
        "success": True,
        "message": f"Pricing reset to defaults (version {new_version})",
        "version": new_version,
        "pricing": DEFAULT_PRICING_DATA
    }


@router.get("/admin/pricing/history")
async def admin_get_pricing_history(
    admin_id: str,
    limit: int = 10,
    db: AsyncSession = Depends(get_db)
):
    """Get pricing configuration history"""
    # Verify admin
    result = await db.execute(select(Profile).where(Profile.id == admin_id))
    admin = result.scalar_one_or_none()
    if not admin or not admin.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    configs_result = await db.execute(
        select(GlobalPricingConfig)
        .order_by(GlobalPricingConfig.version.desc())
        .limit(limit)
    )
    configs = configs_result.scalars().all()
    
    history = []
    for config in configs:
        history.append({
            "version": config.version,
            "updated_at": config.updated_at.isoformat() if config.updated_at else None,
            "updated_by": config.updated_by,
            "is_active": config.is_active
        })
    
    return {"history": history}



# ============================================================
# PRICING AUDIT LOG
# ============================================================

@router.get("/admin/pricing/audit-log")
async def get_pricing_audit_log(
    admin_id: str,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """
    Get detailed audit log of all pricing changes.
    Shows: Admin UID, Old Price, New Price, Timestamp, Field Changed
    """
    # Verify admin
    result = await db.execute(select(Profile).where(Profile.id == admin_id))
    admin = result.scalar_one_or_none()
    if not admin or not admin.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Get all config versions ordered by time
    configs_result = await db.execute(
        select(GlobalPricingConfig)
        .order_by(GlobalPricingConfig.version.desc())
        .limit(limit + 1)  # Get one extra to compare changes
    )
    configs = configs_result.scalars().all()
    
    audit_entries = []
    
    for i, config in enumerate(configs):
        # Get admin info
        admin_result = await db.execute(
            select(Profile).where(Profile.id == config.updated_by)
        )
        admin_user = admin_result.scalar_one_or_none()
        
        entry = {
            "version": config.version,
            "admin_id": config.updated_by,
            "admin_name": admin_user.full_name if admin_user else "Unknown",
            "admin_email": admin_user.email if admin_user else None,
            "timestamp": config.updated_at.isoformat() if config.updated_at else None,
            "is_active": config.is_active,
            "changes": []
        }
        
        # Compare with previous version to detect changes
        if i < len(configs) - 1:
            prev_config = configs[i + 1]
            changes = detect_pricing_changes(prev_config.pricing_data, config.pricing_data)
            entry["changes"] = changes
        else:
            # First version - mark as initial
            entry["changes"] = [{"type": "initial", "description": "Initial pricing configuration"}]
        
        audit_entries.append(entry)
    
    return {
        "audit_log": audit_entries,
        "total_versions": len(configs)
    }


def detect_pricing_changes(old_data: dict, new_data: dict) -> list:
    """
    Compare two pricing configs and return list of changes.
    """
    changes = []
    
    if not old_data or not new_data:
        return [{"type": "config_update", "description": "Configuration updated"}]
    
    for role_key in new_data:
        if role_key not in old_data:
            changes.append({
                "type": "role_added",
                "role": role_key,
                "description": f"Added new role: {role_key}"
            })
            continue
        
        old_role = old_data[role_key]
        new_role = new_data[role_key]
        
        # Check tier changes
        for tier_key in new_role.get('tiers', {}):
            old_tier = old_role.get('tiers', {}).get(tier_key, {})
            new_tier = new_role['tiers'][tier_key]
            
            # Price change
            if old_tier.get('price') != new_tier.get('price'):
                changes.append({
                    "type": "price_change",
                    "role": role_key,
                    "tier": tier_key,
                    "tier_name": new_tier.get('name', tier_key),
                    "old_price": old_tier.get('price'),
                    "new_price": new_tier.get('price'),
                    "description": f"{role_key}/{new_tier.get('name')}: ${old_tier.get('price', 0)} → ${new_tier.get('price', 0)}"
                })
            
            # Name change
            if old_tier.get('name') != new_tier.get('name'):
                changes.append({
                    "type": "name_change",
                    "role": role_key,
                    "tier": tier_key,
                    "old_name": old_tier.get('name'),
                    "new_name": new_tier.get('name'),
                    "description": f"{role_key} tier renamed: {old_tier.get('name')} → {new_tier.get('name')}"
                })
            
            # Features change
            old_features = set(old_tier.get('features', []))
            new_features = set(new_tier.get('features', []))
            
            if old_features != new_features:
                added = new_features - old_features
                removed = old_features - new_features
                
                if added:
                    changes.append({
                        "type": "features_added",
                        "role": role_key,
                        "tier": tier_key,
                        "features": list(added),
                        "description": f"{role_key}/{new_tier.get('name')}: Added features - {', '.join(added)}"
                    })
                
                if removed:
                    changes.append({
                        "type": "features_removed",
                        "role": role_key,
                        "tier": tier_key,
                        "features": list(removed),
                        "description": f"{role_key}/{new_tier.get('name')}: Removed features - {', '.join(removed)}"
                    })
    
    return changes if changes else [{"type": "no_change", "description": "No significant changes detected"}]
