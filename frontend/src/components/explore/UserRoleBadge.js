/**
 * UserRoleBadge.js — Extracted from Explore.js.
 * Displays a role badge for users in search results.
 */
import React from 'react';
import { getExpandedRoleInfo } from '../../contexts/PersonaContext';

const UserRoleBadge = ({ role }) => {
  const roleInfo = getExpandedRoleInfo(role);
  return (
    <span className={`text-sm ${roleInfo.color}`} title={roleInfo.label}>
      {roleInfo.icon}
    </span>
  );
};

export default UserRoleBadge;
