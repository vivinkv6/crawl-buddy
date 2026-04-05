import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it('returns a healthy status payload', () => {
    expect(appController.healthCheck()).toEqual(
      expect.objectContaining({
        status: 'ok',
        message: 'Server Health OK',
      }),
    );
    expect(appController.healthCheck().timestamp).toEqual(expect.any(String));
  });
});
