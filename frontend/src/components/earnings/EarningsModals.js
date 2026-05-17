/**
 * EarningsModals - Extracted from EarningsDashboard.js
 * Contains modal dialogs:
 * - SplitPocketModal: Configure earnings split between cash and platform credits
 * - GearGoalModal: Set savings goals for gear purchases (Hobbyist view)
 */
import React, { useState } from 'react';
import {
  DollarSign, Camera, Heart,
  Wallet, ShoppingBag, Plane, Target
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Slider } from '../ui/slider';
import { toast } from 'sonner';

// Split-Pocket Setup Modal
export var SplitPocketModal = ({ isOpen, onClose, currentSplit, onSave, isLight }) => {
  const [splitPercentage, setSplitPercentage] = useState(currentSplit || 0);
  const [gearFundEnabled, setGearFundEnabled] = useState(splitPercentage > 0);
  
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : 'text-gray-400';
  const borderClass = isLight ? 'border-gray-200' : 'border-zinc-700';
  
  const handleSave = () => {
    onSave(gearFundEnabled ? splitPercentage : 0);
    onClose();
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass} max-w-md`}>
        <DialogHeader>
          <DialogTitle className={`${textPrimaryClass} flex items-center gap-2`}>
            <Wallet className="w-5 h-5 text-cyan-400" />
            Split-Pocket Setup
          </DialogTitle>
        </DialogHeader>
        
        <div className="py-4 space-y-6">
          <p className={`text-sm ${textSecondaryClass}`}>
            Choose how to split your earnings between cash withdrawal and platform credits for gear, travel, and donations.
          </p>
          
          {/* Enable Toggle */}
          <div className={`flex items-center justify-between p-4 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
            <div className="flex items-center gap-3">
              <ShoppingBag className="w-5 h-5 text-amber-400" />
              <div>
                <p className={`font-medium ${textPrimaryClass}`}>Auto-allocate to Credits</p>
                <p className={`text-xs ${textSecondaryClass}`}>For gear, travel & donations</p>
              </div>
            </div>
            <Switch 
              checked={gearFundEnabled} 
              onCheckedChange={setGearFundEnabled}
            />
          </div>
          
          {/* Split Percentage Slider */}
          {gearFundEnabled && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className={textSecondaryClass}>Allocation Percentage</Label>
                <span className="text-cyan-400 font-bold text-xl">{splitPercentage}%</span>
              </div>
              
              <Slider
                value={[splitPercentage]}
                onValueChange={([val]) => setSplitPercentage(val)}
                min={0}
                max={100}
                step={5}
                className="w-full"
              />
              
              {/* Preview */}
              <div className={`p-4 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'}`}>
                <p className={`text-sm ${textSecondaryClass} mb-3`}>For every $100 earned:</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center">
                    <DollarSign className="w-6 h-6 mx-auto mb-1 text-green-400" />
                    <p className="text-green-400 text-xl font-bold">${100 - splitPercentage}</p>
                    <p className={`text-xs ${textSecondaryClass}`}>Cash Available</p>
                  </div>
                  <div className="text-center">
                    <ShoppingBag className="w-6 h-6 mx-auto mb-1 text-amber-400" />
                    <p className="text-amber-400 text-xl font-bold">${splitPercentage}</p>
                    <p className={`text-xs ${textSecondaryClass}`}>Platform Credits</p>
                  </div>
                </div>
              </div>
              
              {/* Spending Paths */}
              <div className={`p-3 rounded-lg ${isLight ? 'bg-blue-50' : 'bg-blue-500/10'} border border-blue-500/30`}>
                <p className={`text-sm ${isLight ? 'text-blue-800' : 'text-blue-400'} font-medium mb-2`}>
                  Credits can be spent on:
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1.5">
                    <ShoppingBag className="w-3 h-3 text-amber-400" />
                    <span className={textSecondaryClass}>Gear (Affiliate Shop)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Plane className="w-3 h-3 text-cyan-400" />
                    <span className={textSecondaryClass}>Travel</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Camera className="w-3 h-3 text-purple-400" />
                    <span className={textSecondaryClass}>Session Fees</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Heart className="w-3 h-3 text-pink-400" />
                    <span className={textSecondaryClass}>Grom Sponsorships</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button 
            onClick={handleSave}
            className="bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-medium"
          >
            Save Settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// Gear Goal Setup Modal (for Hobbyists)
export var GearGoalModal = ({ isOpen, onClose, currentGoal, onSave, isLight }) => {
  const [goalName, setGoalName] = useState(currentGoal?.name || '');
  const [goalAmount, setGoalAmount] = useState(currentGoal?.amount || 500);
  
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : 'text-gray-400';
  const borderClass = isLight ? 'border-gray-200' : 'border-zinc-700';
  const inputBgClass = isLight ? 'bg-white' : 'bg-zinc-800';
  
  const presetGoals = [
    { name: 'New Camera Lens', amount: 800 },
    { name: 'Wetsuit', amount: 300 },
    { name: 'Surf Trip Fund', amount: 1500 },
    { name: 'Board Bag', amount: 150 },
    { name: 'Custom Goal', amount: 500 }
  ];
  
  const handleSave = () => {
    if (!goalName.trim()) {
      toast.error('Please enter a goal name');
      return;
    }
    onSave({ name: goalName, amount: goalAmount });
    onClose();
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass} max-w-md`}>
        <DialogHeader>
          <DialogTitle className={`${textPrimaryClass} flex items-center gap-2`}>
            <Target className="w-5 h-5 text-amber-400" />
            Set Your Gear Goal
          </DialogTitle>
        </DialogHeader>
        
        <div className="py-4 space-y-4">
          <p className={`text-sm ${textSecondaryClass}`}>
            Set a goal for what you're saving up for. Your progress will be tracked as you earn credits.
          </p>
          
          {/* Preset Goals */}
          <div className="space-y-2">
            <Label className={textSecondaryClass}>Quick Select</Label>
            <div className="flex flex-wrap gap-2">
              {presetGoals.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => {
                    setGoalName(preset.name);
                    setGoalAmount(preset.amount);
                  }}
                  className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                    goalName === preset.name
                      ? 'bg-amber-500 text-black font-medium'
                      : `${isLight ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-zinc-800 text-gray-300 hover:bg-zinc-700'}`
                  }`}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>
          
          {/* Custom Name */}
          <div className="space-y-2">
            <Label className={textSecondaryClass}>Goal Name</Label>
            <Input
              value={goalName}
              onChange={(e) => setGoalName(e.target.value)}
              placeholder="e.g., New Camera Lens"
              className={`${inputBgClass} ${textPrimaryClass}`}
            />
          </div>
          
          {/* Amount */}
          <div className="space-y-2">
            <Label className={textSecondaryClass}>Target Amount ($)</Label>
            <Input
              type="number"
              value={goalAmount}
              onChange={(e) => setGoalAmount(parseInt(e.target.value) || 0)}
              min={50}
              max={10000}
              className={`${inputBgClass} ${textPrimaryClass}`}
            />
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button 
            onClick={handleSave}
            className="bg-gradient-to-r from-amber-400 to-orange-500 text-black font-medium"
          >
            Set Goal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
