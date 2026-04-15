"""
Media Upload Service
Handles uploading media to Supabase storage or local fallback
"""
import os
import uuid
import aiohttp
import logging

logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')
UPLOADS_DIR = '/app/backend/uploads'

# Ensure uploads directory exists
os.makedirs(UPLOADS_DIR, exist_ok=True)


async def upload_to_supabase_storage(
    file_bytes: bytes,
    filename: str,
    content_type: str = 'image/jpeg',
    bucket: str = 'conditions'
) -> str:
    """
    Upload file to Supabase storage or fall back to local storage.
    
    Args:
        file_bytes: Raw bytes of the file
        filename: Target filename (can include path like 'conditions/user123/photo.jpg')
        content_type: MIME type of the file
        bucket: Supabase storage bucket name
        
    Returns:
        Public URL of the uploaded file
    """
    if SUPABASE_URL and SUPABASE_SERVICE_KEY:
        try:
            async with aiohttp.ClientSession() as session:
                headers = {
                    'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
                    'Content-Type': content_type,
                    'x-upsert': 'true'
                }
                
                upload_url = f"{SUPABASE_URL}/storage/v1/object/{bucket}/{filename}"
                
                async with session.post(upload_url, data=file_bytes, headers=headers) as response:
                    if response.status in [200, 201]:
                        public_url = f"{SUPABASE_URL}/storage/v1/object/public/{bucket}/{filename}"
                        logger.info(f"Uploaded to Supabase: {public_url}")
                        return public_url
                    else:
                        error_text = await response.text()
                        logger.error(f"Supabase upload failed: {response.status} - {error_text}")
                        raise Exception(f"Supabase upload failed: {response.status}")
        except Exception as e:
            logger.error(f"Supabase upload error: {e}")
            # Fall through to local storage
    
    # Fallback to local storage
    local_filename = f"{uuid.uuid4()}_{os.path.basename(filename)}"
    local_path = os.path.join(UPLOADS_DIR, local_filename)
    
    with open(local_path, 'wb') as f:
        f.write(file_bytes)
    
    local_url = f"/api/uploads/{local_filename}"
    logger.info(f"Saved locally: {local_url}")
    return local_url
