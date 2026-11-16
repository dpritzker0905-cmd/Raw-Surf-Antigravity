/**
 * Send one blind surf observation after its parent report was saved. Best effort: an observation must never block
 * or undo the check-in / go-live / report it rides on, so failures are logged and swallowed.
 * Returns the server's reply ({ id, flags, ... }) or null.
 */
import apiClient from '../../lib/apiClient';
import logger from '../../utils/logger';
import { BUILD_VERSION } from '../../buildVersion';
import observerDeviceId from './deviceId';
import { observationPayload, observationReady } from './BlindHeightInput';

export default async function postObservation({ obs, entryScreen, refId = null, spotId = null, latitude = null,
  longitude = null }) {
  if (!observationReady(obs)) return null;
  // The device clock is recorded as a claim beside the server's own receive time (which is authoritative).
  const body = { entry_screen: entryScreen, ...observationPayload(obs), observed_at_device: new Date().toISOString(),
    client_build: BUILD_VERSION, device_id: observerDeviceId() };
  if (refId) body.ref_id = refId;
  else if (spotId) body.spot_id = spotId;
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    body.latitude = latitude;
    body.longitude = longitude;
  }
  try {
    const res = await apiClient.post('/surf-observations', body);
    return res.data;
  } catch (err) {
    logger.warn('[observation] not recorded:', err?.response?.status || err?.message);
    return null;
  }
}
