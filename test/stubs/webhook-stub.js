/* eslint-disable class-methods-use-this */
export default function createWebhookStub(sendWebhookMessage) {
  return class WebhookStub {
    constructor(id, token) {
      this.id = id;
      this.token = token;
    }

    sendMessage() {
      sendWebhookMessage();
      return new Promise(() => {});
    }
  };
}
