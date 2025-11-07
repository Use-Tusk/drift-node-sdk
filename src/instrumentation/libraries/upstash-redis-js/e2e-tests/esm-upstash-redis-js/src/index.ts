// Initialize SDK first
import './tdInit.js';

import express from 'express';
import { redis } from './db/index.js';
import { TuskDrift } from './tdInit.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', ready: true });
});

// Cleanup endpoint - deletes all test keys to save space
app.get('/cleanup', async (req, res) => {
  try {
    // Get all keys matching test:* pattern
    const keys = await redis.keys('test:*');
    if (keys && keys.length > 0) {
      // Delete all test keys
      await redis.del(...keys);
      res.json({ success: true, message: `Deleted ${keys.length} test keys`, keysDeleted: keys.length });
    } else {
      res.json({ success: true, message: 'No test keys to delete', keysDeleted: 0 });
    }
  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({ success: false, error: String(error) });
  }
});

// ============================================================================
// STRING OPERATIONS
// ============================================================================

app.post('/test/string/set', async (req, res) => {
  try {
    await redis.set('test:string:key1', 'value1');
    res.json({ success: true, operation: 'SET' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/string/get', async (req, res) => {
  try {
    const value = await redis.get('test:string:key1');
    res.json({ success: true, data: { value }, operation: 'GET' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/string/mset', async (req, res) => {
  try {
    await redis.mset({
      'test:string:key2': 'value2',
      'test:string:key3': 'value3',
      'test:string:key4': 'value4'
    });
    res.json({ success: true, operation: 'MSET' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/string/mget', async (req, res) => {
  try {
    const values = await redis.mget('test:string:key2', 'test:string:key3', 'test:string:key4');
    res.json({ success: true, data: { values }, operation: 'MGET' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/string/setex', async (req, res) => {
  try {
    await redis.setex('test:string:expiring', 60, 'will-expire-in-60s');
    res.json({ success: true, operation: 'SETEX' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/string/setnx', async (req, res) => {
  try {
    const result = await redis.setnx('test:string:nx', 'only-if-not-exists');
    res.json({ success: true, data: { set: result }, operation: 'SETNX' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/string/getdel', async (req, res) => {
  try {
    await redis.set('test:string:temp', 'temporary');
    const value = await redis.getdel('test:string:temp');
    res.json({ success: true, data: { value }, operation: 'GETDEL' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/string/append', async (req, res) => {
  try {
    await redis.set('test:string:append', 'Hello');
    const length = await redis.append('test:string:append', ' World');
    res.json({ success: true, data: { length }, operation: 'APPEND' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/string/incr', async (req, res) => {
  try {
    await redis.set('test:string:counter', '10');
    const value = await redis.incr('test:string:counter');
    res.json({ success: true, data: { value }, operation: 'INCR' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/string/incrby', async (req, res) => {
  try {
    await redis.set('test:string:counter2', '10');
    const value = await redis.incrby('test:string:counter2', 5);
    res.json({ success: true, data: { value }, operation: 'INCRBY' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/string/incrbyfloat', async (req, res) => {
  try {
    await redis.set('test:string:float', '10.5');
    const value = await redis.incrbyfloat('test:string:float', 2.5);
    res.json({ success: true, data: { value }, operation: 'INCRBYFLOAT' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/string/decr', async (req, res) => {
  try {
    await redis.set('test:string:counter3', '10');
    const value = await redis.decr('test:string:counter3');
    res.json({ success: true, data: { value }, operation: 'DECR' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/string/decrby', async (req, res) => {
  try {
    await redis.set('test:string:counter4', '10');
    const value = await redis.decrby('test:string:counter4', 3);
    res.json({ success: true, data: { value }, operation: 'DECRBY' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/string/strlen', async (req, res) => {
  try {
    await redis.set('test:string:length', 'Hello World');
    const length = await redis.strlen('test:string:length');
    res.json({ success: true, data: { length }, operation: 'STRLEN' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/string/getrange', async (req, res) => {
  try {
    await redis.set('test:string:range', 'Hello World');
    const substring = await redis.getrange('test:string:range', 0, 4);
    res.json({ success: true, data: { substring }, operation: 'GETRANGE' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/string/setrange', async (req, res) => {
  try {
    await redis.set('test:string:range2', 'Hello World');
    const length = await redis.setrange('test:string:range2', 6, 'Redis');
    res.json({ success: true, data: { length }, operation: 'SETRANGE' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// ============================================================================
// HASH OPERATIONS
// ============================================================================

app.post('/test/hash/hset', async (req, res) => {
  try {
    await redis.hset('test:hash:user1', { name: 'John', age: '30', city: 'NYC' });
    res.json({ success: true, operation: 'HSET' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/hash/hget', async (req, res) => {
  try {
    const name = await redis.hget('test:hash:user1', 'name');
    res.json({ success: true, data: { name }, operation: 'HGET' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/hash/hgetall', async (req, res) => {
  try {
    const user = await redis.hgetall('test:hash:user1');
    res.json({ success: true, data: { user }, operation: 'HGETALL' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/hash/hmset', async (req, res) => {
  try {
    await redis.hset('test:hash:user2', { name: 'Jane', age: '25', city: 'SF' });
    res.json({ success: true, operation: 'HMSET' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/hash/hmget', async (req, res) => {
  try {
    const values = await redis.hmget('test:hash:user1', 'name', 'city');
    res.json({ success: true, data: { values }, operation: 'HMGET' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/hash/hdel', async (req, res) => {
  try {
    const deleted = await redis.hdel('test:hash:user1', 'age');
    res.json({ success: true, data: { deleted }, operation: 'HDEL' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/hash/hexists', async (req, res) => {
  try {
    const exists = await redis.hexists('test:hash:user1', 'name');
    res.json({ success: true, data: { exists }, operation: 'HEXISTS' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/hash/hkeys', async (req, res) => {
  try {
    const keys = await redis.hkeys('test:hash:user1');
    res.json({ success: true, data: { keys }, operation: 'HKEYS' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/hash/hvals', async (req, res) => {
  try {
    const values = await redis.hvals('test:hash:user1');
    res.json({ success: true, data: { values }, operation: 'HVALS' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/hash/hlen', async (req, res) => {
  try {
    const length = await redis.hlen('test:hash:user1');
    res.json({ success: true, data: { length }, operation: 'HLEN' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/hash/hincrby', async (req, res) => {
  try {
    await redis.hset('test:hash:stats', { views: '100' });
    const value = await redis.hincrby('test:hash:stats', 'views', 10);
    res.json({ success: true, data: { value }, operation: 'HINCRBY' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/hash/hincrbyfloat', async (req, res) => {
  try {
    await redis.hset('test:hash:stats2', { rating: '4.5' });
    const value = await redis.hincrbyfloat('test:hash:stats2', 'rating', 0.5);
    res.json({ success: true, data: { value }, operation: 'HINCRBYFLOAT' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/hash/hsetnx', async (req, res) => {
  try {
    const result = await redis.hsetnx('test:hash:user1', 'email', 'john@example.com');
    res.json({ success: true, data: { set: result }, operation: 'HSETNX' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// ============================================================================
// LIST OPERATIONS
// ============================================================================

app.post('/test/list/lpush', async (req, res) => {
  try {
    const length = await redis.lpush('test:list:queue', 'item1', 'item2', 'item3');
    res.json({ success: true, data: { length }, operation: 'LPUSH' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/list/rpush', async (req, res) => {
  try {
    const length = await redis.rpush('test:list:queue', 'item4', 'item5');
    res.json({ success: true, data: { length }, operation: 'RPUSH' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/list/lrange', async (req, res) => {
  try {
    const items = await redis.lrange('test:list:queue', 0, -1);
    res.json({ success: true, data: { items }, operation: 'LRANGE' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/list/lpop', async (req, res) => {
  try {
    const item = await redis.lpop('test:list:queue');
    res.json({ success: true, data: { item }, operation: 'LPOP' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/list/rpop', async (req, res) => {
  try {
    const item = await redis.rpop('test:list:queue');
    res.json({ success: true, data: { item }, operation: 'RPOP' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/list/llen', async (req, res) => {
  try {
    const length = await redis.llen('test:list:queue');
    res.json({ success: true, data: { length }, operation: 'LLEN' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/list/lindex', async (req, res) => {
  try {
    const item = await redis.lindex('test:list:queue', 0);
    res.json({ success: true, data: { item }, operation: 'LINDEX' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/list/lset', async (req, res) => {
  try {
    await redis.lset('test:list:queue', 0, 'new-item');
    res.json({ success: true, operation: 'LSET' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/list/linsert', async (req, res) => {
  try {
    await redis.rpush('test:list:insert', 'a', 'c');
    const length = await redis.linsert('test:list:insert', 'before', 'c', 'b');
    res.json({ success: true, data: { length }, operation: 'LINSERT' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/list/lrem', async (req, res) => {
  try {
    await redis.rpush('test:list:remove', 'x', 'a', 'x', 'b', 'x');
    const removed = await redis.lrem('test:list:remove', 2, 'x');
    res.json({ success: true, data: { removed }, operation: 'LREM' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/list/ltrim', async (req, res) => {
  try {
    await redis.rpush('test:list:trim', '1', '2', '3', '4', '5');
    await redis.ltrim('test:list:trim', 1, 3);
    res.json({ success: true, operation: 'LTRIM' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/list/rpoplpush', async (req, res) => {
  try {
    await redis.rpush('test:list:source', 'item1', 'item2');
    // rpoplpush is deprecated in Upstash, use lmove instead
    const item = await redis.lmove('test:list:source', 'test:list:dest', 'right', 'left');
    res.json({ success: true, data: { item }, operation: 'RPOPLPUSH' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/list/lpos', async (req, res) => {
  try {
    await redis.rpush('test:list:pos', 'a', 'b', 'c', 'b', 'd');
    const position = await redis.lpos('test:list:pos', 'b');
    res.json({ success: true, data: { position }, operation: 'LPOS' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/list/lmove', async (req, res) => {
  try {
    await redis.rpush('test:list:move1', 'item1', 'item2');
    const item = await redis.lmove('test:list:move1', 'test:list:move2', 'left', 'right');
    res.json({ success: true, data: { item }, operation: 'LMOVE' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// ============================================================================
// SET OPERATIONS
// ============================================================================

app.post('/test/set/sadd', async (req, res) => {
  try {
    const added = await redis.sadd('test:set:tags', 'tag1', 'tag2', 'tag3');
    res.json({ success: true, data: { added }, operation: 'SADD' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/set/smembers', async (req, res) => {
  try {
    const members = await redis.smembers('test:set:tags');
    res.json({ success: true, data: { members }, operation: 'SMEMBERS' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/set/sismember', async (req, res) => {
  try {
    const isMember = await redis.sismember('test:set:tags', 'tag1');
    res.json({ success: true, data: { isMember }, operation: 'SISMEMBER' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/set/srem', async (req, res) => {
  try {
    const removed = await redis.srem('test:set:tags', 'tag3');
    res.json({ success: true, data: { removed }, operation: 'SREM' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/set/scard', async (req, res) => {
  try {
    const count = await redis.scard('test:set:tags');
    res.json({ success: true, data: { count }, operation: 'SCARD' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/set/spop', async (req, res) => {
  try {
    await redis.sadd('test:set:pop', 'a', 'b', 'c', 'd');
    const member = await redis.spop('test:set:pop');
    res.json({ success: true, data: { member }, operation: 'SPOP' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/set/srandmember', async (req, res) => {
  try {
    const member = await redis.srandmember('test:set:tags');
    res.json({ success: true, data: { member }, operation: 'SRANDMEMBER' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/set/sdiff', async (req, res) => {
  try {
    await redis.sadd('test:set:set1', 'a', 'b', 'c');
    await redis.sadd('test:set:set2', 'c', 'd', 'e');
    const diff = await redis.sdiff('test:set:set1', 'test:set:set2');
    res.json({ success: true, data: { diff }, operation: 'SDIFF' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/set/sinter', async (req, res) => {
  try {
    const intersection = await redis.sinter('test:set:set1', 'test:set:set2');
    res.json({ success: true, data: { intersection }, operation: 'SINTER' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/set/sunion', async (req, res) => {
  try {
    const union = await redis.sunion('test:set:set1', 'test:set:set2');
    res.json({ success: true, data: { union }, operation: 'SUNION' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/set/smove', async (req, res) => {
  try {
    await redis.sadd('test:set:movesrc', 'a', 'b', 'c');
    await redis.sadd('test:set:movedst', 'x', 'y');
    const moved = await redis.smove('test:set:movesrc', 'test:set:movedst', 'a');
    res.json({ success: true, data: { moved }, operation: 'SMOVE' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// ============================================================================
// SORTED SET OPERATIONS
// ============================================================================

app.post('/test/zset/zadd', async (req, res) => {
  try {
    const added = await redis.zadd('test:zset:leaderboard', { score: 100, member: 'player1' }, { score: 200, member: 'player2' }, { score: 150, member: 'player3' });
    res.json({ success: true, data: { added }, operation: 'ZADD' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/zset/zrange', async (req, res) => {
  try {
    const members = await redis.zrange('test:zset:leaderboard', 0, -1);
    res.json({ success: true, data: { members }, operation: 'ZRANGE' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/zset/zrange-withscores', async (req, res) => {
  try {
    const result = await redis.zrange('test:zset:leaderboard', 0, -1, { withScores: true });
    res.json({ success: true, data: { result }, operation: 'ZRANGE_WITHSCORES' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/zset/zrevrange', async (req, res) => {
  try {
    // zrevrange is not available in Upstash, use zrange with rev option
    const members = await redis.zrange('test:zset:leaderboard', 0, -1, { rev: true });
    res.json({ success: true, data: { members }, operation: 'ZREVRANGE' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/zset/zscore', async (req, res) => {
  try {
    const score = await redis.zscore('test:zset:leaderboard', 'player1');
    res.json({ success: true, data: { score }, operation: 'ZSCORE' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/zset/zincrby', async (req, res) => {
  try {
    const newScore = await redis.zincrby('test:zset:leaderboard', 50, 'player1');
    res.json({ success: true, data: { newScore }, operation: 'ZINCRBY' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/zset/zcard', async (req, res) => {
  try {
    const count = await redis.zcard('test:zset:leaderboard');
    res.json({ success: true, data: { count }, operation: 'ZCARD' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/zset/zcount', async (req, res) => {
  try {
    const count = await redis.zcount('test:zset:leaderboard', 100, 200);
    res.json({ success: true, data: { count }, operation: 'ZCOUNT' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/zset/zrank', async (req, res) => {
  try {
    const rank = await redis.zrank('test:zset:leaderboard', 'player1');
    res.json({ success: true, data: { rank }, operation: 'ZRANK' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/zset/zrevrank', async (req, res) => {
  try {
    const rank = await redis.zrevrank('test:zset:leaderboard', 'player1');
    res.json({ success: true, data: { rank }, operation: 'ZREVRANK' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/zset/zrem', async (req, res) => {
  try {
    const removed = await redis.zrem('test:zset:leaderboard', 'player3');
    res.json({ success: true, data: { removed }, operation: 'ZREM' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/zset/zpopmin', async (req, res) => {
  try {
    await redis.zadd('test:zset:pop', { score: 1, member: 'a' }, { score: 2, member: 'b' }, { score: 3, member: 'c' });
    const result = await redis.zpopmin('test:zset:pop');
    res.json({ success: true, data: { result }, operation: 'ZPOPMIN' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/zset/zpopmax', async (req, res) => {
  try {
    await redis.zadd('test:zset:pop2', { score: 1, member: 'a' }, { score: 2, member: 'b' }, { score: 3, member: 'c' });
    const result = await redis.zpopmax('test:zset:pop2');
    res.json({ success: true, data: { result }, operation: 'ZPOPMAX' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/zset/zrangebyscore', async (req, res) => {
  try {
    // zrangebyscore is not available in Upstash, use zrange with byScore option
    const members = await redis.zrange('test:zset:leaderboard', 100, 200, { byScore: true });
    res.json({ success: true, data: { members }, operation: 'ZRANGEBYSCORE' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/zset/zrevrangebyscore', async (req, res) => {
  try {
    // zrevrangebyscore is not available in Upstash, use zrange with byScore and rev options
    const members = await redis.zrange('test:zset:leaderboard', 200, 100, { byScore: true, rev: true });
    res.json({ success: true, data: { members }, operation: 'ZREVRANGEBYSCORE' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/zset/zremrangebyrank', async (req, res) => {
  try {
    await redis.zadd('test:zset:remrank', { score: 1, member: 'a' }, { score: 2, member: 'b' }, { score: 3, member: 'c' });
    const removed = await redis.zremrangebyrank('test:zset:remrank', 0, 1);
    res.json({ success: true, data: { removed }, operation: 'ZREMRANGEBYRANK' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/zset/zremrangebyscore', async (req, res) => {
  try {
    await redis.zadd('test:zset:remscore', { score: 1, member: 'a' }, { score: 2, member: 'b' }, { score: 3, member: 'c' });
    const removed = await redis.zremrangebyscore('test:zset:remscore', 1, 2);
    res.json({ success: true, data: { removed }, operation: 'ZREMRANGEBYSCORE' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// ============================================================================
// KEY OPERATIONS
// ============================================================================

app.post('/test/key/del', async (req, res) => {
  try {
    await redis.set('test:key:del1', 'value');
    await redis.set('test:key:del2', 'value');
    const deleted = await redis.del('test:key:del1', 'test:key:del2');
    res.json({ success: true, data: { deleted }, operation: 'DEL' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/key/exists', async (req, res) => {
  try {
    await redis.set('test:key:exists', 'value');
    const exists = await redis.exists('test:key:exists');
    res.json({ success: true, data: { exists }, operation: 'EXISTS' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/key/expire', async (req, res) => {
  try {
    await redis.set('test:key:expire', 'value');
    const result = await redis.expire('test:key:expire', 60);
    res.json({ success: true, data: { result }, operation: 'EXPIRE' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/key/expireat', async (req, res) => {
  try {
    await redis.set('test:key:expireat', 'value');
    const timestamp = Math.floor(Date.now() / 1000) + 60;
    const result = await redis.expireat('test:key:expireat', timestamp);
    res.json({ success: true, data: { result }, operation: 'EXPIREAT' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/key/ttl', async (req, res) => {
  try {
    await redis.set('test:key:ttl', 'value');
    await redis.expire('test:key:ttl', 60);
    const ttl = await redis.ttl('test:key:ttl');
    res.json({ success: true, data: { ttl }, operation: 'TTL' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/key/pttl', async (req, res) => {
  try {
    await redis.set('test:key:pttl', 'value');
    await redis.expire('test:key:pttl', 60);
    const pttl = await redis.pttl('test:key:pttl');
    res.json({ success: true, data: { pttl }, operation: 'PTTL' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/key/persist', async (req, res) => {
  try {
    await redis.set('test:key:persist', 'value');
    await redis.expire('test:key:persist', 60);
    const result = await redis.persist('test:key:persist');
    res.json({ success: true, data: { result }, operation: 'PERSIST' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/key/keys', async (req, res) => {
  try {
    await redis.set('test:key:key1', 'value');
    await redis.set('test:key:key2', 'value');
    await redis.set('test:key:key3', 'value');
    const keys = await redis.keys('test:key:key*');
    res.json({ success: true, data: { keys }, operation: 'KEYS' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/key/randomkey', async (req, res) => {
  try {
    const key = await redis.randomkey();
    res.json({ success: true, data: { key }, operation: 'RANDOMKEY' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/key/rename', async (req, res) => {
  try {
    await redis.set('test:key:oldname', 'value');
    await redis.rename('test:key:oldname', 'test:key:newname');
    res.json({ success: true, operation: 'RENAME' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/key/renamenx', async (req, res) => {
  try {
    await redis.set('test:key:oldname2', 'value');
    const result = await redis.renamenx('test:key:oldname2', 'test:key:newname2');
    res.json({ success: true, data: { result }, operation: 'RENAMENX' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/key/type', async (req, res) => {
  try {
    await redis.set('test:key:type', 'value');
    const type = await redis.type('test:key:type');
    res.json({ success: true, data: { type }, operation: 'TYPE' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/key/touch', async (req, res) => {
  try {
    await redis.set('test:key:touch', 'value');
    const result = await redis.touch('test:key:touch');
    res.json({ success: true, data: { result }, operation: 'TOUCH' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/key/unlink', async (req, res) => {
  try {
    await redis.set('test:key:unlink', 'value');
    const deleted = await redis.unlink('test:key:unlink');
    res.json({ success: true, data: { deleted }, operation: 'UNLINK' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// ============================================================================
// BITMAP OPERATIONS
// ============================================================================

app.post('/test/bitmap/setbit', async (req, res) => {
  try {
    const oldValue = await redis.setbit('test:bitmap:bits', 7, 1);
    res.json({ success: true, data: { oldValue }, operation: 'SETBIT' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/bitmap/getbit', async (req, res) => {
  try {
    const value = await redis.getbit('test:bitmap:bits', 7);
    res.json({ success: true, data: { value }, operation: 'GETBIT' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/bitmap/bitcount', async (req, res) => {
  try {
    await redis.setbit('test:bitmap:count', 1, 1);
    await redis.setbit('test:bitmap:count', 3, 1);
    await redis.setbit('test:bitmap:count', 5, 1);
    const count = await redis.bitcount('test:bitmap:count', 0, -1);
    res.json({ success: true, data: { count }, operation: 'BITCOUNT' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/bitmap/bitpos', async (req, res) => {
  try {
    await redis.setbit('test:bitmap:pos', 0, 0);
    await redis.setbit('test:bitmap:pos', 1, 0);
    await redis.setbit('test:bitmap:pos', 2, 1);
    const position = await redis.bitpos('test:bitmap:pos', 1);
    res.json({ success: true, data: { position }, operation: 'BITPOS' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/bitmap/bitop', async (req, res) => {
  try {
    await redis.setbit('test:bitmap:op1', 0, 1);
    await redis.setbit('test:bitmap:op2', 0, 1);
    const length = await redis.bitop('and', 'test:bitmap:opresult', 'test:bitmap:op1', 'test:bitmap:op2');
    res.json({ success: true, data: { length }, operation: 'BITOP' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// ============================================================================
// SERVER OPERATIONS
// ============================================================================

app.get('/test/server/ping', async (req, res) => {
  try {
    const result = await redis.ping();
    res.json({ success: true, data: { result }, operation: 'PING' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/server/dbsize', async (req, res) => {
  try {
    const size = await redis.dbsize();
    res.json({ success: true, data: { size }, operation: 'DBSIZE' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/server/echo', async (req, res) => {
  try {
    const message = await redis.echo('Hello Redis');
    res.json({ success: true, data: { message }, operation: 'ECHO' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// ============================================================================
// HYPERLOGLOG OPERATIONS
// ============================================================================

app.post('/test/hll/pfadd', async (req, res) => {
  try {
    const added = await redis.pfadd('test:hll:visitors', 'user1', 'user2', 'user3');
    res.json({ success: true, data: { added }, operation: 'PFADD' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/hll/pfcount', async (req, res) => {
  try {
    const count = await redis.pfcount('test:hll:visitors');
    res.json({ success: true, data: { count }, operation: 'PFCOUNT' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/hll/pfmerge', async (req, res) => {
  try {
    await redis.pfadd('test:hll:visitors1', 'user1', 'user2');
    await redis.pfadd('test:hll:visitors2', 'user3', 'user4');
    await redis.pfmerge('test:hll:visitorsall', 'test:hll:visitors1', 'test:hll:visitors2');
    res.json({ success: true, operation: 'PFMERGE' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// ============================================================================
// GEO OPERATIONS
// ============================================================================

app.post('/test/geo/geoadd', async (req, res) => {
  try {
    const added = await redis.geoadd('test:geo:locations', { longitude: -122.27652, latitude: 37.805186, member: 'SF' });
    res.json({ success: true, data: { added }, operation: 'GEOADD' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/geo/geopos', async (req, res) => {
  try {
    const positions = await redis.geopos('test:geo:locations', 'SF');
    res.json({ success: true, data: { positions }, operation: 'GEOPOS' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/test/geo/geodist', async (req, res) => {
  try {
    await redis.geoadd('test:geo:cities',
      { longitude: -122.27652, latitude: 37.805186, member: 'SF' },
      { longitude: -118.24368, latitude: 34.052235, member: 'LA' }
    );
    const distance = await redis.geodist('test:geo:cities', 'SF', 'LA', 'KM');
    res.json({ success: true, data: { distance }, operation: 'GEODIST' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/test/geo/geohash', async (req, res) => {
  try {
    const hashes = await redis.geohash('test:geo:locations', 'SF');
    res.json({ success: true, data: { hashes }, operation: 'GEOHASH' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  TuskDrift.markAppAsReady();
});
