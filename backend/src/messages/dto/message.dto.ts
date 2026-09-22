import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for sending a message to a conversation.
 *
 * `content` is a required, non-empty string. The conversation and the
 * Authenticated_User_Id are never accepted from the body — the conversation id
 * comes from the route and the user id is derived from the verified session
 * (Requirement 1.5).
 */
export class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  content!: string;
}
