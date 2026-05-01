export const services = {
  capmonster: {
    createTask: "https://api.capmonster.cloud/createTask",
    getResult: "https://api.capmonster.cloud/getTaskResult",
    getBalance: "https://api.capmonster.cloud/getBalance",
    type: "NoCaptchaTaskProxyless",
  },
  nextcaptcha: {
    createTask: "https://api.nextcaptcha.com/createTask",
    getResult: "https://api.nextcaptcha.com/getTaskResult",
    getBalance: "https://api.nextcaptcha.com/getBalance",
    type: "RecaptchaV2TaskProxyless",
  },
};
