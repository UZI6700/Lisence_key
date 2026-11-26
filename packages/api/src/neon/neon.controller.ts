import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { NeonService } from './neon.service';

/** Read-only diagnostics and Neon service proxies for the admin dashboard. */
@Controller('api/v1/neon')
export class NeonController {
  constructor(private readonly neon: NeonService) {}

  @Get('status')
  status() {
    return this.neon.config();
  }

  @Get('function')
  async function(@Query('slug') slug = 'hello') {
    const result = await this.neon.invokeFunction(slug);
    return { slug, ...result };
  }

  @Get('models')
  async models() {
    return this.neon.models();
  }

  @Post('chat')
  async chat(@Body() body: { model?: string; prompt?: string }) {
    const model = body?.model || 'gpt-5-mini';
    const prompt = body?.prompt || 'Reply with OK';
    return this.neon.chat(model, prompt);
  }

  @Post('realtime/seal')
  async seal(@Body() body: { sql?: string; parameters?: unknown[] }) {
    if (!body?.sql) throw new Error('sql is required');
    const sealed = await this.neon.sealRealtimeQuery(body.sql, body.parameters || []);
    return { sealed };
  }
}
