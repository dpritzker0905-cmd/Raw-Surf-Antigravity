"""
Video Processing Utility
- Check video resolution
- Transcode videos to target resolution (1080p for general users)
- Uses ffmpeg for processing
"""

import subprocess
import json
import os
import uuid
import shutil
from pathlib import Path
from typing import Tuple, Optional
import logging

logger = logging.getLogger(__name__)

# Resolution limits
MAX_FEED_HEIGHT = 1080  # 1080p max for social feed
MAX_FEED_WIDTH = 1920
MAX_GALLERY_HEIGHT = 2160  # 4K allowed for paid photographers
MAX_GALLERY_WIDTH = 3840


def get_video_info(file_path: str) -> Optional[dict]:
    """
    Get video metadata using ffprobe
    Returns: dict with width, height, duration, codec info
    """
    try:
        cmd = [
            'ffprobe',
            '-v', 'quiet',
            '-print_format', 'json',
            '-show_format',
            '-show_streams',
            file_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode != 0:
            logger.error(f"ffprobe error: {result.stderr}")
            return None
        
        data = json.loads(result.stdout)
        
        # Find video stream
        video_stream = None
        for stream in data.get('streams', []):
            if stream.get('codec_type') == 'video':
                video_stream = stream
                break
        
        if not video_stream:
            return None
        
        return {
            'width': int(video_stream.get('width', 0)),
            'height': int(video_stream.get('height', 0)),
            'duration': float(data.get('format', {}).get('duration', 0)),
            'codec': video_stream.get('codec_name', ''),
            'bitrate': int(data.get('format', {}).get('bit_rate', 0)),
            'size': int(data.get('format', {}).get('size', 0))
        }
    except subprocess.TimeoutExpired:
        logger.error("ffprobe timed out")
        return None
    except Exception as e:
        logger.error(f"Error getting video info: {e}")
        return None


def needs_transcoding(video_info: dict, max_height: int = MAX_FEED_HEIGHT, max_width: int = MAX_FEED_WIDTH) -> bool:
    """
    Check if video exceeds resolution limits and needs transcoding
    """
    if not video_info:
        return False
    
    height = video_info.get('height', 0)
    width = video_info.get('width', 0)
    
    return height > max_height or width > max_width


def calculate_target_dimensions(
    width: int, 
    height: int, 
    max_width: int = MAX_FEED_WIDTH, 
    max_height: int = MAX_FEED_HEIGHT
) -> Tuple[int, int]:
    """
    Calculate target dimensions maintaining aspect ratio
    """
    if width <= max_width and height <= max_height:
        return width, height
    
    # Calculate scaling factor based on limiting dimension
    width_ratio = max_width / width
    height_ratio = max_height / height
    
    # Use the smaller ratio to ensure we don't exceed either limit
    scale_factor = min(width_ratio, height_ratio)
    
    new_width = int(width * scale_factor)
    new_height = int(height * scale_factor)
    
    # Ensure dimensions are even (required for some codecs)
    new_width = new_width - (new_width % 2)
    new_height = new_height - (new_height % 2)
    
    return new_width, new_height


def transcode_video(
    input_path: str, 
    output_path: str,
    max_width: int = MAX_FEED_WIDTH,
    max_height: int = MAX_FEED_HEIGHT,
    quality: str = 'medium'
) -> Tuple[bool, Optional[str]]:
    """
    Transcode video to target resolution using ffmpeg
    
    Args:
        input_path: Path to input video
        output_path: Path for output video
        max_width: Maximum output width
        max_height: Maximum output height
        quality: Quality preset (low, medium, high)
    
    Returns:
        Tuple of (success, error_message)
    """
    try:
        # Get video info
        video_info = get_video_info(input_path)
        if not video_info:
            return False, "Could not read video info"
        
        # Calculate target dimensions
        target_width, target_height = calculate_target_dimensions(
            video_info['width'], 
            video_info['height'],
            max_width,
            max_height
        )
        
        # Quality presets (CRF values - lower is better quality, larger file)
        crf_values = {
            'low': '28',
            'medium': '23',
            'high': '18'
        }
        crf = crf_values.get(quality, '23')
        
        # Build ffmpeg command
        cmd = [
            'ffmpeg',
            '-i', input_path,
            '-vf', f'scale={target_width}:{target_height}',
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', crf,
            '-c:a', 'aac',
            '-b:a', '128k',
            '-movflags', '+faststart',  # Enable streaming
            '-y',  # Overwrite output
            output_path
        ]
        
        logger.info(f"Transcoding video: {video_info['width']}x{video_info['height']} -> {target_width}x{target_height}")
        
        # Run transcode (with timeout based on duration + overhead)
        timeout = max(60, int(video_info['duration']) * 2 + 30)
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        
        if result.returncode != 0:
            logger.error(f"ffmpeg error: {result.stderr}")
            return False, f"Transcoding failed: {result.stderr[:200]}"
        
        # Verify output
        if not os.path.exists(output_path):
            return False, "Output file not created"
        
        output_info = get_video_info(output_path)
        if not output_info:
            return False, "Could not verify output video"
        
        logger.info(f"Transcoding complete: {output_info['width']}x{output_info['height']}, size: {output_info['size']} bytes")
        return True, None
        
    except subprocess.TimeoutExpired:
        return False, "Transcoding timed out"
    except Exception as e:
        logger.error(f"Transcoding error: {e}")
        return False, str(e)


def process_video_upload(
    file_content: bytes,
    filename: str,
    upload_dir: Path,
    user_subscription: str = 'free',
    upload_type: str = 'feed'  # 'feed' or 'gallery'
) -> Tuple[bool, Optional[str], Optional[dict]]:
    """
    Process video upload with resolution checking and optional transcoding
    
    Args:
        file_content: Raw video bytes
        filename: Original filename
        upload_dir: Directory to save files
        user_subscription: User's subscription tier
        upload_type: 'feed' (1080p cap) or 'gallery' (4K for paid photographers)
    
    Returns:
        Tuple of (success, error_message, result_data)
    """
    try:
        # Determine max resolution based on upload type and subscription
        if upload_type == 'gallery' and user_subscription in ['basic', 'premium']:
            # Paid photographers can upload 4K to gallery
            max_width = MAX_GALLERY_WIDTH
            max_height = MAX_GALLERY_HEIGHT
        else:
            # Feed posts or free users: 1080p limit
            max_width = MAX_FEED_WIDTH
            max_height = MAX_FEED_HEIGHT
        
        # Generate unique filenames
        base_name = str(uuid.uuid4())
        ext = Path(filename).suffix.lower() or '.mp4'
        temp_filename = f"{base_name}_temp{ext}"
        
        # Force MP4 wrapper for universal iOS / Webkit playback security
        final_filename = f"{base_name}.mp4"
        
        # Create upload directory if needed
        upload_dir.mkdir(parents=True, exist_ok=True)
        
        temp_path = upload_dir / temp_filename
        final_path = upload_dir / final_filename
        
        # Save temp file
        with open(temp_path, 'wb') as f:
            f.write(file_content)
        
        # Get video info
        video_info = get_video_info(str(temp_path))
        if not video_info:
            os.remove(temp_path)
            return False, "Could not read video file", None
        
        result_data = {
            'original_width': video_info['width'],
            'original_height': video_info['height'],
            'duration': video_info['duration'],
            'was_transcoded': False,
            'filename': final_filename
        }
        
        # Check if transcoding is needed (Resolution check OR Container check)
        is_mp4 = ext == '.mp4'
        if needs_transcoding(video_info, max_height, max_width) or not is_mp4:
            # Transcode
            success, error = transcode_video(
                str(temp_path), 
                str(final_path),
                max_width,
                max_height
            )
            
            # Clean up temp file
            os.remove(temp_path)
            
            if not success:
                return False, f"Video transcoding failed: {error}", None
            
            result_data['was_transcoded'] = True
            
            # Get final video info
            final_info = get_video_info(str(final_path))
            if final_info:
                result_data['final_width'] = final_info['width']
                result_data['final_height'] = final_info['height']
                result_data['size'] = final_info['size']
        else:
            # Native MP4 at correct resolution, safely migrate to CDN pipeline
            shutil.move(str(temp_path), str(final_path))
            result_data['final_width'] = video_info['width']
            result_data['final_height'] = video_info['height']
            result_data['size'] = video_info['size']
        
        return True, None, result_data
        
    except Exception as e:
        logger.error(f"Video processing error: {e}")
        return False, str(e), None


# Utility to check if ffmpeg is available
def check_ffmpeg_available() -> bool:
    """Check if ffmpeg is installed and accessible"""
    try:
        result = subprocess.run(['ffmpeg', '-version'], capture_output=True, text=True, timeout=5)
        return result.returncode == 0
    except Exception:
        return False



def generate_video_thumbnail(
    video_path: str,
    output_path: str,
    strategy: str = 'smart',
    timestamp: float = None
) -> Tuple[bool, Optional[str]]:
    """
    Generate a thumbnail from a video file.
    
    Strategies:
    - 'first': First frame
    - 'middle': Frame at 50% duration
    - 'smart': Analyzes multiple frames and picks the one with highest visual interest
    - 'timestamp': Specific timestamp in seconds
    
    Returns:
        Tuple of (success, error_message)
    """
    try:
        video_info = get_video_info(video_path)
        if not video_info:
            return False, "Could not read video info"
        
        duration = video_info.get('duration', 0)
        
        if strategy == 'first':
            capture_time = 0.5  # Half second in to skip black frames
        elif strategy == 'middle':
            capture_time = duration / 2 if duration > 0 else 0.5
        elif strategy == 'timestamp' and timestamp is not None:
            capture_time = min(timestamp, duration - 0.1) if duration > 0 else 0
        elif strategy == 'smart':
            # Analyze multiple frames and pick the best one
            return _generate_smart_thumbnail(video_path, output_path, duration)
        else:
            capture_time = min(2.0, duration / 4) if duration > 4 else 0.5
        
        # Extract single frame
        cmd = [
            'ffmpeg',
            '-ss', str(capture_time),
            '-i', video_path,
            '-vframes', '1',
            '-q:v', '2',  # High quality JPEG
            '-y',
            output_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode != 0:
            logger.error(f"Thumbnail extraction error: {result.stderr}")
            return False, f"Thumbnail extraction failed"
        
        if not os.path.exists(output_path):
            return False, "Thumbnail file not created"
        
        return True, None
        
    except subprocess.TimeoutExpired:
        return False, "Thumbnail generation timed out"
    except Exception as e:
        logger.error(f"Thumbnail error: {e}")
        return False, str(e)


def _generate_smart_thumbnail(
    video_path: str,
    output_path: str,
    duration: float
) -> Tuple[bool, Optional[str]]:
    """
    Generate thumbnail by analyzing multiple frames and selecting
    the one with highest visual interest (based on variance/contrast).
    """
    import tempfile
    
    try:
        # Sample 5 frames at different points (10%, 25%, 50%, 75%, 90% of duration)
        sample_points = [0.1, 0.25, 0.5, 0.75, 0.9]
        if duration < 2:
            sample_points = [0.5]  # Short video, just use middle
        
        temp_dir = tempfile.mkdtemp()
        candidates = []
        
        for i, point in enumerate(sample_points):
            timestamp = duration * point
            temp_path = os.path.join(temp_dir, f"frame_{i}.jpg")
            
            cmd = [
                'ffmpeg',
                '-ss', str(timestamp),
                '-i', video_path,
                '-vframes', '1',
                '-q:v', '2',
                '-y',
                temp_path
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            
            if result.returncode == 0 and os.path.exists(temp_path):
                # Calculate image "interest" score using ffprobe to get frame stats
                score = _calculate_frame_interest(temp_path)
                candidates.append((temp_path, score, timestamp))
        
        if not candidates:
            # Fallback to simple middle frame
            shutil.rmtree(temp_dir, ignore_errors=True)
            return generate_video_thumbnail(video_path, output_path, strategy='middle')
        
        # Select frame with highest interest score
        candidates.sort(key=lambda x: x[1], reverse=True)
        best_frame = candidates[0][0]
        
        # Copy best frame to output
        shutil.copy(best_frame, output_path)
        
        # Cleanup temp files
        shutil.rmtree(temp_dir, ignore_errors=True)
        
        logger.info(f"Smart thumbnail: selected frame at {candidates[0][2]:.1f}s (score: {candidates[0][1]:.2f})")
        return True, None
        
    except Exception as e:
        logger.error(f"Smart thumbnail error: {e}")
        # Fallback to middle frame
        return generate_video_thumbnail(video_path, output_path, strategy='middle')


def _calculate_frame_interest(image_path: str) -> float:
    """
    Calculate visual interest score for an image.
    Higher score = more visually interesting (more contrast, more edges).
    Uses ffmpeg's signalstats filter to analyze the frame.
    """
    try:
        # Use ffmpeg to calculate frame statistics
        cmd = [
            'ffprobe',
            '-v', 'quiet',
            '-show_entries', 'frame_tags=lavfi.signalstats.YAVG,lavfi.signalstats.YMAX,lavfi.signalstats.YMIN',
            '-f', 'lavfi',
            f'movie={image_path},signalstats'
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        
        if result.returncode != 0:
            # Fallback: use file size as proxy for visual complexity
            return os.path.getsize(image_path) / 1000.0
        
        # Parse output for contrast (YMAX - YMIN) and average brightness
        lines = result.stdout.strip().split('\n')
        ymax, ymin, yavg = 255, 0, 128
        
        for line in lines:
            if 'YMAX' in line:
                try:
                    ymax = float(line.split('=')[1])
                except (ValueError, IndexError):
                    pass
            elif 'YMIN' in line:
                try:
                    ymin = float(line.split('=')[1])
                except (ValueError, IndexError):
                    pass
            elif 'YAVG' in line:
                try:
                    yavg = float(line.split('=')[1])
                except (ValueError, IndexError):
                    pass
        
        # Score based on:
        # - Contrast (YMAX - YMIN) - higher is better
        # - Not too dark or bright (penalize extreme averages)
        contrast_score = (ymax - ymin) / 255.0
        brightness_score = 1.0 - abs(yavg - 128) / 128.0  # Best when avg ~128
        
        return contrast_score * 0.7 + brightness_score * 0.3
        
    except Exception as e:
        logger.warning(f"Frame interest calculation failed: {e}")
        # Fallback to file size
        try:
            return os.path.getsize(image_path) / 1000.0
        except Exception:
            return 0.5
