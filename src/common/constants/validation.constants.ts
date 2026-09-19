import { ValidationPipeOptions } from '@nestjs/common';

/** Global ValidationPipe options, shared by src/main.ts and tests. */
export const APP_VALIDATION_PIPE_OPTIONS: ValidationPipeOptions = Object.freeze(
  {
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  },
);
