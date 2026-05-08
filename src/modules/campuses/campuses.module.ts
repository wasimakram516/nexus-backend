import { Module } from '@nestjs/common';
import { CampusesController } from './campuses.controller';
import { CampusesService } from './campuses.service';

@Module({
  controllers: [CampusesController],
  providers: [CampusesService],
})
export class CampusesModule {}
