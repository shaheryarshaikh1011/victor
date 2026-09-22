import { IsString } from 'class-validator';

/**
 * Body for a settings update.
 *
 * Basic shape validation is applied here; the (provider, model) pair is
 * additionally validated against the backend allow-list in `UsersService`
 * (Requirements 2.2, 2.3). Both fields are required strings so an update always
 * specifies a complete pair.
 */
export class UpdateSettingsDto {
  @IsString()
  provider!: string;

  @IsString()
  model!: string;
}
