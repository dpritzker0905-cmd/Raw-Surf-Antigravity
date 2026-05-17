import React from 'react';
import { getExpandedRoleInfo } from '../../contexts/PersonaContext';

const RoleBadge = ({ role }) => {
  const roleInfo = getExpandedRoleInfo(role);
  return (
    <span className={`text-sm ${roleInfo.color}`} title={roleInfo.label}>
      {roleInfo.icon}
    </span>
  );
};

export default RoleBadge;
