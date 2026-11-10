import { handleChat } from '../../scripts/pages-chat.mjs';
export const onRequest = ({request, env}) => handleChat(request, env);
