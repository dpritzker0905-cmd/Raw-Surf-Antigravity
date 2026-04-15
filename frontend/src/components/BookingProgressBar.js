import React from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { Check, FileText, Users, CreditCard } from 'lucide-react';

/**
 * BookingProgressBar - 3-step visualization for booking checkout flow
 * Steps: Details -> Crew Hub -> Confirm
 */

export const BookingProgressBar = ({ currentStep = 1, bookingType = 'scheduled' }) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const steps = [
    { id: 1, name: 'Details', icon: FileText, description: bookingType === 'on_demand' ? 'Select duration' : 'Select date & spot' },
    { id: 2, name: 'Crew Hub', icon: Users, description: 'Add & split with crew' },
    { id: 3, name: 'Confirm', icon: CreditCard, description: 'Review & pay' }
  ];

  return (
    <div className="w-full py-4" data-testid="booking-progress-bar">
      <div className="flex items-center justify-between max-w-lg mx-auto px-4">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const isCompleted = currentStep > step.id;
          const isCurrent = currentStep === step.id;
          const isUpcoming = currentStep < step.id;
          
          return (
            <React.Fragment key={step.id}>
              {/* Step indicator */}
              <div className="flex flex-col items-center">
                <div 
                  className={`
                    w-10 h-10 rounded-full flex items-center justify-center 
                    transition-all duration-300 
                    ${isCompleted 
                      ? 'bg-green-500 text-white' 
                      : isCurrent 
                        ? 'bg-cyan-500 text-black ring-2 ring-cyan-400 ring-offset-2 ring-offset-black' 
                        : isLight
                          ? 'bg-gray-200 text-gray-400'
                          : 'bg-zinc-800 text-zinc-500'
                    }
                  `}
                >
                  {isCompleted ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    <Icon className="w-5 h-5" />
                  )}
                </div>
                
                <div className="mt-2 text-center">
                  <p className={`text-sm font-medium ${
                    isCurrent 
                      ? 'text-cyan-400' 
                      : isCompleted 
                        ? (isLight ? 'text-green-600' : 'text-green-400')
                        : (isLight ? 'text-gray-400' : 'text-gray-500')
                  }`}>
                    {step.name}
                  </p>
                  <p className={`text-xs hidden sm:block ${
                    isLight ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                    {step.description}
                  </p>
                </div>
              </div>

              {/* Connector line */}
              {index < steps.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 transition-colors ${
                  currentStep > step.id 
                    ? 'bg-green-500' 
                    : isLight 
                      ? 'bg-gray-200'
                      : 'bg-zinc-800'
                }`} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export default BookingProgressBar;
