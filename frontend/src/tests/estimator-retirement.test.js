import React from 'react';
import { REQUIRED_CELLS, updateRetirementSummary } from '../components/map/euroExtendedEstimate';

describe("Estimator Retirement Aggregator Gate", () => {
  beforeEach(() => {
    // Clear tested cells log
    window.__TESTED_CELLS_LOG__ = {};
    window.__MARINE_ESTIMATOR_RETIREMENT_SUMMARY__ = undefined;
  });

  const populateSuccessMatrix = () => {
    window.__TESTED_CELLS_LOG__ = {};
    REQUIRED_CELLS.forEach(cell => {
      const key = `${cell.model}_${cell.layer}_${cell.offset}`;
      if (cell.unsupported) {
        window.__TESTED_CELLS_LOG__[key] = {
          model: cell.model,
          layer: cell.layer,
          offset: cell.offset,
          status: 'unsupported',
          provider: 'none',
          frontendEstimatorCalled: false,
          calledFunc: null,
          fallbackReason: 'unsupported_model_layer',
          backendProductActive: false,
          gridPointParity: null
        };
      } else {
        window.__TESTED_CELLS_LOG__[key] = {
          model: cell.model,
          layer: cell.layer,
          offset: cell.offset,
          status: 'backend_owned_no_estimator',
          provider: cell.model === 'EURO' ? 'copernicus' : 'backend-weather-service',
          frontendEstimatorCalled: false,
          calledFunc: null,
          fallbackReason: 'backend_redirect_active',
          backendProductActive: true,
          gridPointParity: 'parity_pass'
        };
      }
    });
  };

  test("1. All 36 cells successful => safeToDeleteNow is true", () => {
    populateSuccessMatrix();
    updateRetirementSummary();

    const summary = window.__MARINE_ESTIMATOR_RETIREMENT_SUMMARY__;
    expect(summary).toBeDefined();
    expect(summary.matrixTotal).toBe(36);
    expect(summary.matrixPassed).toBe(36);
    expect(summary.matrixFailed).toBe(0);
    expect(summary.untestedCells).toBe(0);
    expect(summary.estimatorInvocationCount).toBe(0);
    expect(summary.safeToDeleteNow).toBe(true);
    expect(summary.verdict).toBe("safe_to_delete_candidate");
  });

  test("2. Backend flag active but backendProductActive is false => safeToDeleteNow is false", () => {
    populateSuccessMatrix();
    // Invalidate one supported cell
    const targetKey = "EURO_waves_120";
    window.__TESTED_CELLS_LOG__[targetKey].backendProductActive = false;

    updateRetirementSummary();

    const summary = window.__MARINE_ESTIMATOR_RETIREMENT_SUMMARY__;
    expect(summary.safeToDeleteNow).toBe(false);
    expect(summary.matrixPassed).toBe(35);
    expect(summary.matrixFailed).toBe(1);
    expect(summary.verdict).toBe("safe_to_delete_blocked");
  });

  test("3. Grid/point mismatch => safeToDeleteNow is false", () => {
    populateSuccessMatrix();
    // Introduce grid/point mismatch
    const targetKey = "EURO_waves_120";
    window.__TESTED_CELLS_LOG__[targetKey].gridPointParity = "mismatch";

    updateRetirementSummary();

    const summary = window.__MARINE_ESTIMATOR_RETIREMENT_SUMMARY__;
    expect(summary.safeToDeleteNow).toBe(false);
    expect(summary.matrixPassed).toBe(35);
    expect(summary.matrixFailed).toBe(1);
    expect(summary.verdict).toBe("safe_to_delete_blocked");
  });

  test("4. Estimator invocation => safeToDeleteNow is false", () => {
    populateSuccessMatrix();
    // Simulate estimator called on a supported cell
    const targetKey = "EURO_waves_120";
    window.__TESTED_CELLS_LOG__[targetKey].frontendEstimatorCalled = true;
    window.__TESTED_CELLS_LOG__[targetKey].calledFunc = "estimateEuroGrid";
    window.__TESTED_CELLS_LOG__[targetKey].status = "frontend_estimator_regression";

    updateRetirementSummary();

    const summary = window.__MARINE_ESTIMATOR_RETIREMENT_SUMMARY__;
    expect(summary.safeToDeleteNow).toBe(false);
    expect(summary.estimatorInvocationCount).toBe(1);
    expect(summary.verdict).toBe("safe_to_delete_blocked");
  });

  test("5. ICON swell_2 unsupported without estimator => passes for unsupported cell", () => {
    populateSuccessMatrix();
    
    // swell_2 at 0 and 72 must have status 'unsupported' and estimatorCalled: false
    const key0 = "ICON_swell_2_0";
    const key72 = "ICON_swell_2_72";
    
    expect(window.__TESTED_CELLS_LOG__[key0].frontendEstimatorCalled).toBe(false);
    expect(window.__TESTED_CELLS_LOG__[key72].frontendEstimatorCalled).toBe(false);

    updateRetirementSummary();

    const summary = window.__MARINE_ESTIMATOR_RETIREMENT_SUMMARY__;
    expect(summary.safeToDeleteNow).toBe(true);
    expect(summary.verdict).toBe("safe_to_delete_candidate");
  });

  test("6. ICON swell_2 with estimator called => fails for unsupported cell", () => {
    populateSuccessMatrix();
    
    const key72 = "ICON_swell_2_72";
    window.__TESTED_CELLS_LOG__[key72].frontendEstimatorCalled = true;
    window.__TESTED_CELLS_LOG__[key72].calledFunc = "estimateEuroPoint";

    updateRetirementSummary();

    const summary = window.__MARINE_ESTIMATOR_RETIREMENT_SUMMARY__;
    expect(summary.safeToDeleteNow).toBe(false);
    expect(summary.matrixPassed).toBe(35);
    expect(summary.matrixFailed).toBe(1);
    expect(summary.verdict).toBe("safe_to_delete_blocked");
  });

  test("7. Untested cells => safeToDeleteNow is false", () => {
    populateSuccessMatrix();
    // Delete one cell from logs
    delete window.__TESTED_CELLS_LOG__["EURO_waves_120"];

    updateRetirementSummary();

    const summary = window.__MARINE_ESTIMATOR_RETIREMENT_SUMMARY__;
    expect(summary.safeToDeleteNow).toBe(false);
    expect(summary.untestedCells).toBe(1);
    expect(summary.untestedList).toContain("EURO_waves_120");
    expect(summary.verdict).toBe("safe_to_delete_blocked");
  });
});
