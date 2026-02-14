import { Module, Global } from '@nestjs/common';
import { RedisService } from './redis.service';
import Redis from 'ioredis';

@Global()
@Module({
  providers: [
    RedisService,
    {
      provide: 'REDIS_CLIENT',
      useFactory: () => {
        const url = process.env.REDIS_URL;

        if (!url) {
          throw new Error('REDIS_URL environment variable is not defined');
        }

        const client = new Redis(url, {
          // 🔥 IMPORTANT FIX (prevents MaxRetriesPerRequestError)
          maxRetriesPerRequest: null,
          
          // Force TLS for Upstash/Production Redis
          tls: {},
          
          // IPv4/IPv6 compatibility
          family: 0,

          // Recommended for Upstash / serverless Redis
          enableReadyCheck: false,

          // Keep connection stable
          keepAlive: 10000,

          // Reconnect strategy (exponential backoff)
          retryStrategy: (times: number) => {
            const delay = Math.min(times * 100, 3000);
            return delay;
          },

          reconnectOnError: (err: Error) => {
            if (err.message.includes('READONLY')) {
              return true;
            }
            return false;
          },
        });

        // ✅ Connection logs (very useful for debugging)
        client.on('connect', () => {
          console.log('✅ Redis connected');
        });

        client.on('ready', () => {
          console.log('🚀 Redis ready');
        });

        client.on('reconnecting', () => {
          console.warn('🔄 Redis reconnecting...');
        });

        client.on('error', (err: Error) => {
          console.error('❌ Redis Error:', err.message);
        });

        client.on('close', () => {
          console.warn('⚠️ Redis connection closed');
        });

        return client;
      },
    },
  ],
  exports: [RedisService, 'REDIS_CLIENT'],
})
export class RedisModule {}
