import React from 'react';
import { PhotoMatchingUnavailableDialog } from './gallery/PhotoMatchingUnavailableDialog';

export const LockerSelfieModal = ({ isOpen, onClose }) => (
  <PhotoMatchingUnavailableDialog open={isOpen} onClose={onClose} />
);
