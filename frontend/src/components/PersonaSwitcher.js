import React, { useState } from 'react';
import { usePersona, ALL_PERSONAS, getExpandedRoleInfo } from '../contexts/PersonaContext';
import { ChevronDown, Check, Eye, Shield } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';

const PersonaSwitcher = () => {
  const { activePersona, setPersona, exitPersonaMode, isGodMode, isPersonaBarActive } = usePersona();
  const [isOpen, setIsOpen] = useState(false);
  
  if (!isGodMode) return null;
  
  const currentRoleInfo = activePersona 
    ? getExpandedRoleInfo(activePersona) 
    : { icon: '🔴', label: 'God Mode (Default)', color: 'text-red-500' };
  
  // Handle selecting "God Mode (Default)" - exit persona mode completely
  const handleExitToDefault = () => {
    exitPersonaMode();
    setIsOpen(false);
  };
  
  return (
    <Card className="bg-zinc-900 border-red-500/30 mb-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-white flex items-center gap-2">
          <Shield className="w-5 h-5 text-red-500" />
          Persona Switcher
          <span className="text-xs text-gray-400 font-normal ml-2">(God Mode Tool)</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-gray-400 mb-3">
          Select a persona to test the app as any user role. The cyan bar will appear at the top when active.
        </p>
        
        {/* Dropdown Trigger */}
        <div className="relative">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="w-full flex items-center justify-between px-4 py-3 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors"
            data-testid="persona-switcher-dropdown"
          >
            <div className="flex items-center gap-2">
              <span className="text-xl">{currentRoleInfo.icon}</span>
              <span className="text-white font-medium">{currentRoleInfo.label}</span>
            </div>
            <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>
          
          {/* Dropdown Menu */}
          {isOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 max-h-80 overflow-y-auto">
              {/* God Mode Default Option - exits persona mode */}
              <button
                onClick={handleExitToDefault}
                className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-700 transition-colors ${
                  !activePersona && !isPersonaBarActive ? 'bg-red-500/10 border-l-2 border-red-500' : ''
                }`}
              >
                <span className="text-xl">🔴</span>
                <div className="flex-1 text-left">
                  <span className="text-white font-medium">God Mode (Default)</span>
                  <p className="text-xs text-gray-400">Exit persona mode - full admin view</p>
                </div>
                {!activePersona && !isPersonaBarActive && <Check className="w-5 h-5 text-red-500" />}
              </button>
              
              <div className="border-t border-zinc-700 my-1" />
              
              {/* All Personas */}
              {ALL_PERSONAS.filter(p => p.id !== 'God').map((persona) => {
                const roleInfo = getExpandedRoleInfo(persona.id);
                const isSelected = activePersona === persona.id;
                
                return (
                  <button
                    key={persona.id}
                    onClick={() => { setPersona(persona.id); setIsOpen(false); }}
                    className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-700 transition-colors ${
                      isSelected ? `${roleInfo.bgColor} border-l-2 ${roleInfo.color.replace('text-', 'border-')}` : ''
                    }`}
                    data-testid={`persona-option-${persona.id}`}
                  >
                    <span className="text-xl">{roleInfo.icon}</span>
                    <div className="flex-1 text-left">
                      <span className="text-white font-medium">{persona.label}</span>
                      <p className="text-xs text-gray-400">{persona.description}</p>
                    </div>
                    {isSelected && <Check className={`w-5 h-5 ${roleInfo.color}`} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        
        {/* Current Mask Info */}
        {isPersonaBarActive && activePersona && (
          <div className="mt-3 p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-lg">
            <div className="flex items-center gap-2 text-cyan-400">
              <Eye className="w-4 h-4" />
              <span className="text-sm font-medium">
                Currently viewing as: {getExpandedRoleInfo(activePersona).label}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Navigate the app to test this persona's experience. Click EXIT in the top bar to return to admin view.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default PersonaSwitcher;
