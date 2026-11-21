/*

╭━━╮╱╱╱╱╱╱╱╱╱╭━━━╮╱╱╱╱╱╱╱╱╱╱╱╭╮
╰┫┣╯╱╱╱╱╱╱╱╱╱┃╭━╮┃╱╱╱╱╭╮╱╱╱╱╭╯╰╮
╱┃┃╭━━┳━━┳━╮╱┃╰━╯┣━┳━━╋╋━━┳━┻╮╭╯
╱┃┃┃╭╮┃╭╮┃╭╮╮┃╭━━┫╭┫╭╮┣┫┃━┫╭━┫┃
╭┫┣┫╰╯┃╭╮┃┃┃┃┃┃╱╱┃┃┃╰╯┃┃┃━┫╰━┫╰╮
╰━━┫╭━┻╯╰┻╯╰╯╰╯╱╱╰╯╰━━┫┣━━┻━━┻━╯
╱╱╱┃┃╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╭╯┃
╱╱╱╰╯╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╰━╯
*/
export interface WebhookDeliveryStatus {
  ok: boolean;
  event: string;
  message: string;
  at: string;
}

const deliveries = new Map<string, WebhookDeliveryStatus>();

export function setWebhookDeliveryStatus(
  key: string,
  status: Omit<WebhookDeliveryStatus, 'at'>
): void {
  deliveries.set(key, {
    ...status,
    at: new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium' })
  });
}

export function getWebhookDeliveryStatus(key: string): WebhookDeliveryStatus | null {
  const status = deliveries.get(key);
  return status ? { ...status } : null;
}
