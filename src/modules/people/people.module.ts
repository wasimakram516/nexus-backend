import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PeopleController } from './people.controller';
import { PeopleService } from './people.service';
import { StudentImportService } from './student-import.service';

@Module({
  imports: [AuthModule],
  controllers: [PeopleController],
  providers: [PeopleService, StudentImportService],
})
export class PeopleModule {}
