// Board type options
export const BOARD_TYPES = [
  { value: 'shortboard', label: 'Shortboard' },
  { value: 'longboard', label: 'Longboard' },
  { value: 'funboard', label: 'Funboard' },
  { value: 'fish', label: 'Fish' },
  { value: 'gun', label: 'Gun' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'mini_mal', label: 'Mini Mal' },
  { value: 'foamie', label: 'Soft Top / Foamie' },
  { value: 'sup', label: 'SUP' },
  { value: 'other', label: 'Other' }
];

// Fin setup options
export const FIN_SETUPS = [
  { value: 'thruster', label: 'Thruster (3 fin)' },
  { value: 'quad', label: 'Quad (4 fin)' },
  { value: 'twin', label: 'Twin Fin' },
  { value: 'single', label: 'Single Fin' },
  { value: '2_plus_1', label: '2+1' },
  { value: 'five', label: '5 Fin' },
  { value: 'finless', label: 'Finless' }
];

// Condition options
export const CONDITIONS = [
  { value: 'mint', label: 'Mint', color: 'text-green-400' },
  { value: 'excellent', label: 'Excellent', color: 'text-cyan-400' },
  { value: 'good', label: 'Good', color: 'text-blue-400' },
  { value: 'fair', label: 'Fair', color: 'text-yellow-400' },
  { value: 'needs_repair', label: 'Needs Repair', color: 'text-red-400' }
];
