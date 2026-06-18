import json
with open('backend/uploads/weather_products/manifest.json') as f:
    d = json.load(f)
    euro_waves = [p for p in d['products'] if p['model'] == 'EURO' and p['domain'] == 'marine' and p['layer'] == 'waves']
    print(f"Total: {len(euro_waves)}")
    if euro_waves:
        euro_waves.sort(key=lambda x: x['valid_time_start'])
        print(f"Earliest: {euro_waves[0]['valid_time_start']} ({euro_waves[0]['provider']})")
        print(f"Latest: {euro_waves[-1]['valid_time_start']} ({euro_waves[-1]['provider']})")
        
        # Let's count by provider and estimated
        providers = {}
        for p in euro_waves:
            k = (p['provider'], p['is_estimated'], p.get('region_id'))
            providers[k] = providers.get(k, 0) + 1
        print("Breakdown by (provider, is_estimated, region):")
        for k, v in providers.items():
            print(f"  {k}: {v}")
