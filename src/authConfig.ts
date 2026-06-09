import { PublicClientApplication } from "@azure/msal-browser";

const msalConfig = {
  auth: {
    clientId: "95623ecf-00bb-4289-a553-a64ae3a22ebb",
    authority: "https://login.microsoftonline.com/b678434e-f26d-4d7f-947b-204156adc399",
    redirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: "localStorage",
    storeAuthStateInCookie: false,
  },
};

export const msalInstance = new PublicClientApplication(msalConfig);

export const loginRequest = {
  scopes: ["User.Read", "openid", "profile", "email"],
};
