import React from 'react';
import { Minus, Plus } from 'lucide-react';

/**
 * NumericStepper - Standard numeric input with increment/decrement buttons
 * Replaces Slider/Range inputs for consistency across pricing flows
 */
export const NumericStepper = ({
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  prefix = '',
  suffix = '',
  label,
  description,
  disabled = false,
  className = '',
  size = 'default', // 'sm', 'default', 'lg'
  theme = 'dark'
}) => {
  const isLight = theme === 'light';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : 'text-gray-400';
  const bgClass = isLight ? 'bg-gray-100' : 'bg-zinc-800';
  const borderClass = isLight ? 'border-gray-300' : 'border-zinc-600';
  const buttonBg = isLight ? 'bg-gray-200 hover:bg-gray-300' : 'bg-zinc-700 hover:bg-zinc-600';
  
  const sizeStyles = {
    sm: { wrapper: 'h-10', input: 'text-lg', button: 'w-8 h-10' },
    default: { wrapper: 'h-12', input: 'text-xl', button: 'w-10 h-12' },
    lg: { wrapper: 'h-14', input: 'text-2xl', button: 'w-12 h-14' }
  };
  
  const styles = sizeStyles[size] || sizeStyles.default;
  
  const handleIncrement = () => {
    if (!disabled && value < max) {
      onChange(Math.min(max, value + step));
    }
  };
  
  const handleDecrement = () => {
    if (!disabled && value > min) {
      onChange(Math.max(min, value - step));
    }
  };
  
  const handleInputChange = (e) => {
    const newValue = parseFloat(e.target.value) || 0;
    if (newValue >= min && newValue <= max) {
      onChange(newValue);
    }
  };
  
  return (
    <div className={className}>
      {label && (
        <label className={`block font-medium ${textPrimary} mb-2`}>{label}</label>
      )}
      
      <div className={`flex items-center rounded-xl border ${borderClass} overflow-hidden ${styles.wrapper}`}>
        {/* Decrement Button */}
        <button
          type="button"
          onClick={handleDecrement}
          disabled={disabled || value <= min}
          className={`${styles.button} flex items-center justify-center ${buttonBg} border-r ${borderClass} transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
          data-testid="stepper-decrement"
        >
          <Minus className="w-4 h-4" />
        </button>
        
        {/* Value Display/Input */}
        <div className={`flex-1 flex items-center justify-center ${bgClass} px-3`}>
          <span className={`${textSecondary} mr-1`}>{prefix}</span>
          <input
            type="number"
            value={value}
            onChange={handleInputChange}
            disabled={disabled}
            min={min}
            max={max}
            step={step}
            className={`w-full text-center ${styles.input} font-bold ${textPrimary} bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
            data-testid="stepper-input"
          />
          <span className={`${textSecondary} ml-1`}>{suffix}</span>
        </div>
        
        {/* Increment Button */}
        <button
          type="button"
          onClick={handleIncrement}
          disabled={disabled || value >= max}
          className={`${styles.button} flex items-center justify-center ${buttonBg} border-l ${borderClass} transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
          data-testid="stepper-increment"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
      
      {description && (
        <p className={`text-xs ${textSecondary} mt-2`}>{description}</p>
      )}
    </div>
  );
};

export default NumericStepper;
