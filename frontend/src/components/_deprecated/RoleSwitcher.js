import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { toast } from 'sonner';

const ALL_ROLES = [
  'Grom', 'Surfer', 'Comp Surfer', 'Pro',
  'Grom Parent', 'Hobbyist', 'Photographer', 'Approved Pro',
  'School', 'Coach', 'Resort', 'Wave Pool', 'Shop', 'Shaper'
];

export const RoleSwitcher = () => {
  const { user, switchRole } = useAuth();
  const [selectedRole, setSelectedRole] = useState(user?.role || 'Surfer');

  const handleSwitch = () => {
    switchRole(selectedRole);
    toast.success(`Switched to ${selectedRole} role`);
  };

  if (!user) return null;

  return (
    <Card className="mb-4" data-testid="role-switcher-card">
      <CardHeader>
        <CardTitle className="text-lg flex items-center justify-between">
          <span>Role Switcher (Dev Tool)</span>
          <Badge variant="outline" data-testid="current-role-badge">{user.role}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2">
          <Select value={selectedRole} onValueChange={setSelectedRole}>
            <SelectTrigger className="flex-1" data-testid="role-switcher-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALL_ROLES.map(role => (
                <SelectItem key={role} value={role} data-testid={`role-switcher-option-${role}`}>
                  {role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button 
            onClick={handleSwitch} 
            className="bg-gradient-to-r from-emerald-400 via-yellow-400 to-orange-400 hover:from-emerald-500 hover:via-yellow-500 hover:to-orange-500 text-black font-medium border-0"
            data-testid="switch-role-button"
          >
            Switch
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};