class TwilioSmsProvider {
  constructor(environment = process.env, fetchImplementation = fetch) {
    this.environment = environment;
    this.fetch = fetchImplementation;
  }

  isConfigured() {
    return this.environment.SMS_PROVIDER === 'twilio' &&
      Boolean(this.environment.TWILIO_ACCOUNT_SID) &&
      Boolean(this.environment.TWILIO_AUTH_TOKEN) &&
      Boolean(this.environment.TWILIO_FROM_NUMBER);
  }

  async send(to, message) {
    if (!this.isConfigured()) {
      throw new Error('Dịch vụ gửi SMS chưa được cấu hình.');
    }

    const accountSid = this.environment.TWILIO_ACCOUNT_SID;
    const credentials = Buffer.from(`${accountSid}:${this.environment.TWILIO_AUTH_TOKEN}`).toString('base64');
    const response = await this.fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          To: to,
          From: this.environment.TWILIO_FROM_NUMBER,
          Body: message
        }),
        signal: AbortSignal.timeout(10000)
      }
    );
    if (!response.ok) {
      throw new Error('Nhà cung cấp SMS không xác nhận việc gửi mã.');
    }
    const result = await response.json();
    if (!result.sid) {
      throw new Error('Nhà cung cấp SMS không xác nhận việc gửi mã.');
    }
    return { confirmed: true };
  }
}

module.exports = { TwilioSmsProvider };
