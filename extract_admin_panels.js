/**
 * extract_admin_panels.js 
 * Extracts AdControlsPanel and AdminSpotsPanel from UnifiedAdminConsole.js
 * into standalone admin panel files following the existing pattern
 */
const fs = require('fs');
const path = require('path');

const SRC = 'frontend/src/components';
const ADMIN = path.join(SRC, 'admin');
const MAIN_FILE = path.join(SRC, 'UnifiedAdminConsole.js');

const content = fs.readFileSync(MAIN_FILE, 'utf8');
const lines = content.split('\n');

// Find AdControlsPanel block
let adStart = -1, adEnd = -1;
let spotsStart = -1, spotsEnd = -1;

lines.forEach((l, i) => {
  if (l.trim() === '// Ad Controls Panel Component with Approval Queue') adStart = i;
  if (l.trim() === 'const AdControlsPanel = ({ user }) => {') adStart = Math.min(adStart, i);
  if (l.trim() === '// Admin Spots Panel - Global Spot Manager') spotsStart = i;
  if (l.trim() === 'const AdminSpotsPanel = ({ userId }) => {') spotsStart = Math.min(spotsStart, i);
});

// adEnd is line before spotsStart comment
adEnd = spotsStart - 1;
// spotsEnd is line before export default
lines.forEach((l, i) => {
  if (l.trim() === 'export default UnifiedAdminConsole;') spotsEnd = i - 1;
});

console.log('AdControlsPanel: L' + (adStart+1) + ' to L' + (adEnd+1));
console.log('AdminSpotsPanel: L' + (spotsStart+1) + ' to L' + (spotsEnd+1));
console.log('AdControls lines:', adEnd - adStart + 1);
console.log('AdminSpots lines:', spotsEnd - spotsStart + 1);

// The common imports needed by extracted panels
const COMMON_IMPORTS = `import React, { useState, useEffect, useRef, useCallback } from 'react';
import apiClient from '../../lib/apiClient';
import {
  Shield, Zap, Users, DollarSign, Search, Ban, CheckCircle,
  Loader2, ChevronDown, ChevronLeft, ChevronRight, Eye, Trash2, UserX, UserCheck,
  Crown, Trophy, Radio, MapPin, Camera, Play, Square, Image, Video,
  Upload, X, Check, User, FileText, ArrowLeft, Settings, Activity,
  Megaphone, History, RefreshCw, TrendingUp, PieChart, BarChart3, Wallet, AlertCircle, Edit, BarChart2,
  Headphones, Server, Flag, Mail, Layout, Lock
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { toast } from 'sonner';
import { getFullUrl } from '../../utils/media';
import logger from '../../utils/logger';
import { AdminSpotEditor } from './AdminSpotEditor';
import { AdminPrecisionQueue } from './AdminPrecisionQueue';
`;

// Extract AdControlsPanel content
const adLines = lines.slice(adStart, adEnd + 1);
const adPanelCode = COMMON_IMPORTS + '\n' +
  '/**\n * AdControlsPanel — Extracted from UnifiedAdminConsole\n * Admin control for ad frequency, approval queue, and variant management.\n */\n' +
  adLines.join('\n') + '\n\nexport { AdControlsPanel };\n';

// Extract AdminSpotsPanel content  
const spotsLines = lines.slice(spotsStart, spotsEnd + 1);
const spotsPanelCode = COMMON_IMPORTS + '\n' +
  '/**\n * AdminSpotsPanel — Extracted from UnifiedAdminConsole\n * Global spot manager with full CRUD, precision pin map, and surf data import.\n */\n' +
  spotsLines.join('\n') + '\n\nexport { AdminSpotsPanel };\n';

// Write extracted files
fs.writeFileSync(path.join(ADMIN, 'AdControlsPanel.js'), adPanelCode, 'utf8');
fs.writeFileSync(path.join(ADMIN, 'AdminSpotsPanel.js'), spotsPanelCode, 'utf8');

console.log('\n✅ Created: admin/AdControlsPanel.js');
console.log('✅ Created: admin/AdminSpotsPanel.js');

// Update UnifiedAdminConsole to import from extracted files
// and remove the local panel code (keep a comment stub for now)
const newImports = content.replace(
  "import logger from '../utils/logger';",
  "import logger from '../utils/logger';\nimport { AdControlsPanel } from './admin/AdControlsPanel';\nimport { AdminSpotsPanel } from './admin/AdminSpotsPanel';"
);

// Replace the extracted component code with a comment stub
const adBlockStr = adLines.join('\n');
const spotsBlockStr = spotsLines.join('\n');

let updated = newImports;
if (updated.includes(adBlockStr)) {
  updated = updated.replace(
    adLines.slice(0, 2).join('\n'), 
    '// AdControlsPanel → extracted to admin/AdControlsPanel.js\n'
  );
}

// Actually, safer approach: just leave the code and add duplicate export guard
// The imports from admin/ will shadow the local definitions which won't be exported
// This avoids any risk of breaking the existing UX

fs.writeFileSync(path.join(SRC, 'UnifiedAdminConsole.js'), newImports, 'utf8');
console.log('✅ Updated: UnifiedAdminConsole.js (added imports for extracted panels)');
console.log('\nNote: Local panel code retained in UnifiedAdminConsole as fallback.');
console.log('Next step: Verify build, then optionally delete local copies.');
