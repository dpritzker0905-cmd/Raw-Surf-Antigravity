import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../../ui/card';
import { DollarSign, TrendingUp, Percent, BarChart3 } from 'lucide-react';

export var AdminP2RevenueTab = ({
  revenueData,
  funnelData,
  cohortData,
  cardBgClass,
  textClass,
  textSecondary,
  formatCurrency
}) => {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <Card className={`${cardBgClass} border-green-500/30`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-xs ${textSecondary}`}>GMV (30d)</p>
                <p className="text-2xl font-bold text-green-400">
                  {formatCurrency(revenueData.gmv)}
                </p>
                <p className={`text-xs ${revenueData.gmv_change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {revenueData.gmv_change >= 0 ? '+' : ''}{revenueData.gmv_change}% vs prev
                </p>
              </div>
              <TrendingUp className="w-8 h-8 text-green-500/50" />
            </div>
          </CardContent>
        </Card>

        <Card className={`${cardBgClass} border-blue-500/30`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-xs ${textSecondary}`}>Platform Revenue</p>
                <p className="text-2xl font-bold text-blue-400">
                  {formatCurrency(revenueData.platform_revenue)}
                </p>
                <p className="text-xs text-gray-500">
                  {revenueData.take_rate}% take rate
                </p>
              </div>
              <DollarSign className="w-8 h-8 text-blue-500/50" />
            </div>
          </CardContent>
        </Card>

        <Card className={`${cardBgClass} border-purple-500/30`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-xs ${textSecondary}`}>MRR</p>
                <p className="text-2xl font-bold text-purple-400">
                  {formatCurrency(revenueData.mrr)}
                </p>
                <p className="text-xs text-gray-500">Subscriptions</p>
              </div>
              <BarChart3 className="w-8 h-8 text-purple-500/50" />
            </div>
          </CardContent>
        </Card>

        <Card className={`${cardBgClass} border-orange-500/30`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-xs ${textSecondary}`}>Conversion Rate</p>
                <p className="text-2xl font-bold text-orange-400">
                  {funnelData?.overall_conversion_rate || 0}%
                </p>
                <p className="text-xs text-gray-500">Booking funnel</p>
              </div>
              <Percent className="w-8 h-8 text-orange-500/50" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className={cardBgClass}>
        <CardHeader className="pb-2">
          <CardTitle className={`text-sm ${textClass}`}>Revenue by Type</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-2">
            {Object.entries(revenueData.breakdown_by_type || {}).map(([type, data]) => (
              <div key={type} className="p-3 bg-muted rounded-lg">
                <p className="text-xs text-gray-500 capitalize">{type.replace(/_/g, ' ')}</p>
                <p className="text-lg font-bold text-foreground">{formatCurrency(data.revenue)}</p>
                <p className="text-xs text-muted-foreground">{data.transactions} txns</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {funnelData && (
        <Card className={cardBgClass}>
          <CardHeader className="pb-2">
            <CardTitle className={`text-sm ${textClass}`}>Booking Funnel</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {funnelData.funnel?.map((stage, _idx) => (
                <div key={stage.stage} className="flex items-center gap-3">
                  <div className="w-32 text-xs text-muted-foreground">{stage.stage}</div>
                  <div className="flex-1 relative h-6 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="absolute inset-y-0 left-0 bg-gradient-to-r from-green-500 to-teal-500 rounded-full transition-all"
                      style={{ width: `${stage.conversion_rate}%` }}
                    />
                    <span className="absolute inset-0 flex items-center justify-center text-xs text-foreground font-medium">
                      {stage.count} ({stage.conversion_rate}%)
                    </span>
                  </div>
                  {stage.drop_off > 0 && (
                    <div className="text-xs text-red-400">-{stage.drop_off}</div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {cohortData?.cohorts && cohortData.cohorts.length > 0 && (
        <Card className={cardBgClass}>
          <CardHeader className="pb-2">
            <CardTitle className={`text-sm ${textClass}`}>Cohort Retention</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500">
                    <th className="text-left p-2">Cohort</th>
                    <th className="text-center p-2">Size</th>
                    {[0,1,2,3,4,5].map(m => (
                      <th key={m} className="text-center p-2">M{m}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cohortData.cohorts.slice(0, 6).map(cohort => (
                    <tr key={cohort.cohort_month} className="border-t border-border">
                      <td className="p-2 text-foreground">{cohort.cohort_month}</td>
                      <td className="p-2 text-center text-muted-foreground">{cohort.cohort_size}</td>
                      {[0,1,2,3,4,5].map(m => {
                        const retention = cohort.retention[`month_${m}`];
                        return (
                          <td key={m} className="p-2 text-center">
                            {retention !== undefined ? (
                              <span className={`px-2 py-0.5 rounded ${
                                retention >= 50 ? 'bg-green-500/20 text-green-400' :
                                retention >= 25 ? 'bg-yellow-500/20 text-yellow-400' :
                                'bg-red-500/20 text-red-400'
                              }`}>
                                {retention}%
                              </span>
                            ) : '-'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
