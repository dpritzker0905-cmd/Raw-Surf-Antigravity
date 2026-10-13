/**
 * F-15 (audit 14.0) — a failed Open-Meteo protocol registration must be LOUD, not silent.
 *
 * THE DEFECT THIS PINS. `registerOpenMeteoProtocol` runs everything inside
 * `import('@openmeteo/weather-map-layer').then(cb)`, and `setProtocolReady(true)` is the LAST
 * statement of a ~400-line `cb`. The chain had no `.catch`. `MapWebGL.js` gates its entire raster
 * slot factory on `protocolReady`, so any throw in that callback left rain / satellite / pressure /
 * temperature / water_temp / fog mounting ZERO sources — six blank layers, no console error, no
 * telemetry, and a truth HUD that read "LOADING" forever because a not-visible raster had no other
 * word for itself.
 *
 * ⚠️ HONEST SCOPE: F-15 was filed SUSPECTED-BY-CONSTRUCTION, NOT OBSERVED. No live throw was ever
 * produced. These tests therefore prove the HANDLING, not that the failure occurs.
 *
 * ⭐ THE TEST THAT MATTERS is `registerOpenMeteoProtocol` with the library module forced to throw —
 * a real rejecting `import()`, not a hand-called reporter. Everything else could pass while the
 * production chain stayed uncaught, which is exactly the bug.
 */

describe('F-15 protocol registration failure disclosure', () => {
  let mod;
  let errSpy;

  beforeEach(() => {
    jest.resetModules();
    mod = require('./openMeteoProtocolFailure');
    mod._resetProtocolFailureForTest();
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
    try { mod._resetProtocolFailureForTest(); } catch (e) { /* ignore */ }
  });

  describe('the record', () => {
    it('starts clean — the positive control for every "it was recorded" assertion below', () => {
      // Without this, a reporter that recorded nothing would make the null-checks below vacuous.
      expect(mod.isOpenMeteoProtocolFailed()).toBe(false);
      expect(mod.getOpenMeteoProtocolFailure()).toBeNull();
      expect(window.__OM_PROTOCOL_FAILURE__).toBeUndefined();
    });

    it('captures the REAL error — message, name and stack, not a summary', () => {
      const err = new TypeError('Loading chunk 42 failed');
      const rec = mod.reportProtocolRegistrationFailure(err);

      expect(rec.message).toBe('Loading chunk 42 failed');
      expect(rec.name).toBe('TypeError');
      // The stack is what distinguishes a chunk-load failure from a colour-scale assign, and those
      // have opposite repairs — dropping it would make the log unactionable.
      expect(rec.stack).toEqual(expect.stringContaining('Loading chunk 42 failed'));
      expect(mod.isOpenMeteoProtocolFailed()).toBe(true);
    });

    it('survives a non-Error throw rather than reporting "undefined"', () => {
      const rec = mod.reportProtocolRegistrationFailure('plain string boom');
      expect(rec.message).toBe('plain string boom');
      expect(rec.name).toBe('Error');
    });

    it('logs the error object itself and names every layer that goes dark', () => {
      const err = new Error('boom');
      mod.reportProtocolRegistrationFailure(err);

      expect(errSpy).toHaveBeenCalled();
      const [msg, passed] = errSpy.mock.calls[0];
      expect(passed).toBe(err);           // the object, so devtools can expand it
      for (const layer of ['rain', 'satellite', 'pressure', 'temperature', 'water_temp', 'fog']) {
        expect(msg).toEqual(expect.stringContaining(layer));
      }
    });

    it('publishes the forensic global an investigator actually reads', () => {
      mod.reportProtocolRegistrationFailure(new Error('boom'));
      expect(window.__OM_PROTOCOL_FAILURE__).toEqual(mod.getOpenMeteoProtocolFailure());
      expect(window.__OM_PROTOCOL_FAILURE__.message).toBe('boom');
    });

    it('pins the gate FALSE — never leaves a half-registered protocol reading ready', () => {
      const setReady = jest.fn();
      mod.reportProtocolRegistrationFailure(new Error('boom'), setReady);
      expect(setReady).toHaveBeenCalledWith(false);
      expect(setReady).not.toHaveBeenCalledWith(true);
    });
  });

  describe('subscription', () => {
    it('notifies a listener that subscribed BEFORE the failure', () => {
      const seen = jest.fn();
      mod.subscribeToProtocolFailure(seen);
      mod.reportProtocolRegistrationFailure(new Error('boom'));
      expect(seen).toHaveBeenCalledTimes(1);
      expect(seen.mock.calls[0][0].message).toBe('boom');
    });

    it('THE RACE: fires immediately for a listener that subscribed AFTER', () => {
      // Registration can fail before the HUD or the toast host mounts. A subscribe-only
      // implementation would show "LOADING" forever in exactly the case it exists to disclose.
      mod.reportProtocolRegistrationFailure(new Error('already dead'));
      const late = jest.fn();
      mod.subscribeToProtocolFailure(late);
      expect(late).toHaveBeenCalledTimes(1);
      expect(late.mock.calls[0][0].message).toBe('already dead');
    });

    it('fires at most once per listener', () => {
      const seen = jest.fn();
      mod.subscribeToProtocolFailure(seen);
      mod.reportProtocolRegistrationFailure(new Error('one'));
      mod.reportProtocolRegistrationFailure(new Error('two'));
      expect(seen).toHaveBeenCalledTimes(1);
    });

    it('unsubscribe actually detaches', () => {
      const seen = jest.fn();
      mod.subscribeToProtocolFailure(seen)();
      mod.reportProtocolRegistrationFailure(new Error('boom'));
      expect(seen).not.toHaveBeenCalled();
    });

    it('a throwing listener cannot take down the others', () => {
      const good = jest.fn();
      mod.subscribeToProtocolFailure(() => { throw new Error('bad listener'); });
      mod.subscribeToProtocolFailure(good);
      expect(() => mod.reportProtocolRegistrationFailure(new Error('boom'))).not.toThrow();
      expect(good).toHaveBeenCalledTimes(1);
    });
  });

  describe('the reporter cannot itself become the silent failure', () => {
    it('still records when telemetry throws', () => {
      jest.resetModules();
      jest.doMock('./WeatherTelemetry', () => ({
        WeatherTelemetry: { trackModelError: () => { throw new Error('telemetry down'); } },
      }));
      const m2 = require('./openMeteoProtocolFailure');
      m2._resetProtocolFailureForTest();
      expect(() => m2.reportProtocolRegistrationFailure(new Error('boom'))).not.toThrow();
      expect(m2.isOpenMeteoProtocolFailed()).toBe(true);
      jest.dontMock('./WeatherTelemetry');
    });

    it('emits model_error (terminal), not model_warning (recoverable)', () => {
      jest.resetModules();
      const trackModelError = jest.fn();
      const trackModelWarning = jest.fn();
      jest.doMock('./WeatherTelemetry', () => ({
        WeatherTelemetry: { trackModelError, trackModelWarning },
      }));
      const m2 = require('./openMeteoProtocolFailure');
      m2._resetProtocolFailureForTest();
      m2.reportProtocolRegistrationFailure(new Error('boom'));

      expect(trackModelError).toHaveBeenCalledTimes(1);
      expect(trackModelError.mock.calls[0][1]).toBe('om_protocol_registration_failed');
      // Nothing recovers from this state, and the two event types are filtered differently
      // downstream — a warning would be triaged as transient.
      expect(trackModelWarning).not.toHaveBeenCalled();
      jest.dontMock('./WeatherTelemetry');
    });
  });
});

/**
 * ⭐ THE PRODUCTION CHAIN. Forces the real dynamic import to REJECT and asserts the real
 * `registerOpenMeteoProtocol` catches it. This is the assertion that would have failed before the
 * fix; every test above would have passed against the uncaught code.
 */
describe('F-15 registerOpenMeteoProtocol catches a rejecting import()', () => {
  beforeEach(() => jest.resetModules());

  it('does not reject, and reports the failure instead of stranding protocolReady', async () => {
    jest.doMock('@openmeteo/weather-map-layer', () => { throw new Error('Loading chunk failed'); });
    jest.doMock('./colorScales', () => ({ CUSTOM_COLOR_SCALES: {}, aliasSurfaceTemperature: () => {} }));

    const failureMod = require('./openMeteoProtocolFailure');
    failureMod._resetProtocolFailureForTest();
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { registerOpenMeteoProtocol } = require('./openMeteoProtocol');
    const setProtocolReady = jest.fn();

    // An unhandled rejection here is the defect itself, so the assertion is that awaiting the
    // microtask queue stays quiet AND the disclosure landed.
    expect(() => registerOpenMeteoProtocol(
      { addProtocol: () => {} }, setProtocolReady, new Map(),
    )).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));

    expect(failureMod.isOpenMeteoProtocolFailed()).toBe(true);
    expect(failureMod.getOpenMeteoProtocolFailure().message)
      .toEqual(expect.stringContaining('Loading chunk failed'));
    // The gate must never read ready after a failed registration.
    expect(setProtocolReady).not.toHaveBeenCalledWith(true);

    errSpy.mockRestore();
    failureMod._resetProtocolFailureForTest();
  });
});
