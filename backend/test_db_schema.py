import asyncio
import asyncpg

async def main():
    try:
        conn = await asyncpg.connect('postgresql://postgres.jnfbxcvcbtndtsvscppt:Labocana%23123@aws-0-us-east-2.pooler.supabase.com:6543/postgres')
        print('Connected successfully!')
        
        # Check profiles columns
        query = '''
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'profiles';
        '''
        columns = await conn.fetch(query)
        col_names = [col['column_name'] for col in columns]
        print(f'Columns in profiles: {col_names}')
        
        if 'username' not in col_names:
            print('CRITICAL: username column DOES NOT EXIST in the database!')
        else:
            print('username column exists.')
            
        await conn.close()
    except Exception as e:
        print(f'DB error: {e}')

asyncio.run(main())
