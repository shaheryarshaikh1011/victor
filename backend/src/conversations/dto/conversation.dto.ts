import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for creating a conversation.
 *
 * `title` is optional; when omitted the service assigns a default title. The
 * ownership user id is never accepted from the body — it is derived from the
 * verified session (Requirement 1.5).
 */
export class CreateConversationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;
}
