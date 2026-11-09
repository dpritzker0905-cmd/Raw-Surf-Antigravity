import { useEffect, useState } from 'react';
import { getHeightUnit, setHeightUnit } from './heightUnits';

/** Subscribe each mounted control surface to the existing display-only preference. */
export default function useHeightUnit() {
  const [unit, setUnit] = useState(getHeightUnit);
  useEffect(() => {
    const onUnit = event => {
      const next = event.detail?.unit;
      setUnit(next === 'm' || next === 'ft' ? next : getHeightUnit());
    };
    window.addEventListener('rawsurf:height-unit', onUnit);
    return () => window.removeEventListener('rawsurf:height-unit', onUnit);
  }, []);
  const toggle = () => setUnit(setHeightUnit(unit === 'ft' ? 'm' : 'ft'));
  return [unit, toggle];
}
