/**
 * AdminP1TestAccountsTab - Test account seeding & management tab
 * Extracted from AdminP1Dashboard.js for modularization (v74)
 */
import React from 'react';
import { Users, Eye, Loader2, Copy } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../../ui/card';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Badge } from '../../ui/badge';
import { Avatar, AvatarFallback } from '../../ui/avatar';

const AdminP1TestAccountsTab = ({
  testAccounts, testAccountPassword, setTestAccountPassword,
  seedAllRoleAccounts, seedingAccounts,
  cleanupOldTestAccounts, actionLoading,
  copyCredentials, startImpersonation,
  setSearchUserQuery, setSearchResults, setImpersonationReason,
  cardBgClass, textClass, textSecondary,
}) => (
  <div className="space-y-4">
    {/* Seed Accounts Card */}
    <Card className={cardBgClass}>
      <CardHeader>
        <CardTitle className={`flex items-center gap-2 ${textClass}`}>
          <Users className="w-5 h-5 text-green-400" />
          Seed Test Accounts
        </CardTitle>
        <p className={`text-sm ${textSecondary}`}>
          Create test accounts for QA testing. All accounts use @test.rawsurf.io email domain.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label className={`text-xs ${textSecondary}`}>Password for new accounts</label>
            <Input
              value={testAccountPassword}
              onChange={(e) => setTestAccountPassword(e.target.value)}
              className="bg-muted border-border"
              placeholder="Test123!"
            />
          </div>
          <Button aria-label="Loader2"
            onClick={seedAllRoleAccounts}
            disabled={seedingAccounts}
            className="bg-green-500 hover:bg-green-600 text-white"
            data-testid="seed-all-roles-btn"
          >
            {seedingAccounts ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Seed All Roles
          </Button>
          <Button
            onClick={cleanupOldTestAccounts}
            disabled={actionLoading}
            variant="outline"
            className="border-red-500/50 text-red-400 hover:bg-red-500/10"
            data-testid="cleanup-test-accounts-btn"
          >
            Cleanup Old (&gt;7 days)
          </Button>
        </div>
        
        <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
          <p className={`text-sm ${textClass}`}>
            <strong>Seed All Roles</strong> creates one account for each role type:
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            {['Surfer', 'Photographer', 'Approved Pro', 'Grom', 'GromParent', 'Competitive Surfer'].map(role => (
              <Badge key={role} variant="outline" className="text-green-400 border-green-500/50">
                {role}
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>

    {/* Existing Test Accounts */}
    <Card className={cardBgClass}>
      <CardHeader>
        <CardTitle className={`flex items-center gap-2 ${textClass}`}>
          <Users className="w-5 h-5 text-blue-400" />
          Existing Test Accounts
          <Badge className="ml-2 bg-blue-500/20 text-blue-400">{testAccounts.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {testAccounts.length === 0 ? (
          <p className={`text-center py-8 ${textSecondary}`}>
            No test accounts found. Click "Seed All Roles" to create test accounts.
          </p>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {testAccounts.map(account => (
              <div 
                key={account.id}
                className="flex items-center gap-3 p-3 bg-muted rounded-lg hover:bg-input transition-colors"
                data-testid={`test-account-${account.id}`}
              >
                <Avatar>
                  <AvatarFallback className="bg-blue-500/20 text-blue-400">
                    {account.full_name?.[0] || '?'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className={`font-medium ${textClass} truncate`}>{account.full_name}</p>
                  <p className={`text-sm ${textSecondary} truncate`}>{account.email}</p>
                </div>
                <Badge variant="outline" className="shrink-0">{account.role}</Badge>
                {account.is_verified && (
                  <Badge className="bg-cyan-500/20 text-cyan-400 shrink-0">Verified</Badge>
                )}
                {account.is_approved_pro && (
                  <Badge className="bg-purple-500/20 text-purple-400 shrink-0">Pro</Badge>
                )}
                <Button aria-label="Copy"
                  size="sm"
                  variant="outline"
                  onClick={() => copyCredentials(account)}
                  className="shrink-0"
                >
                  <Copy className="w-4 h-4" />
                </Button>
                <Button aria-label="View"
                  size="sm"
                  onClick={() => {
                    setSearchUserQuery('');
                    setSearchResults([]);
                    setImpersonationReason('QA testing');
                    startImpersonation(account.id);
                  }}
                  className="bg-purple-500 hover:bg-purple-600 shrink-0"
                >
                  <Eye className="w-4 h-4 mr-1" />
                  View As
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  </div>
);

export default AdminP1TestAccountsTab;
