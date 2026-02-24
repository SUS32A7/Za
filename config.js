module.exports = {
  server: {
    port: process.env.PORT || 3001,
    host: process.env.HOST || "0.0.0.0",
  },

  // Your API key for THIS proxy (what SillyTavern sends)
  auth: {
    enabled: true,
    token: process.env.AUTH_TOKEN || "Waguri",
  },

  // Z.AI credentials - FILL THESE IN
  zai: {
    // Your Bearer token from chat.z.ai (the JWT from the Authorization header)
    bearerToken: process.env.ZAI_BEARER_TOKEN || "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjdhNWRlY2IyLTkyZTItNDY3NS05OWY1LThmMDQ2MmJmOTExYiIsImVtYWlsIjoiZjUwM3N1c0BnbWFpbC5jb20ifQ.skpdmpauQGz0DOQK50N0Kcj0UWC061NAF_QretdRbXoAYeL8lTiW981vXfkEs47ZiyfVlb-cBXQtUblrCvpHrA",

    // Your user_id from the request URL
    userId: process.env.ZAI_USER_ID || "7a5decb2-92e2-4675-99f5-8f0462bf911b",

    // Default model
    model: process.env.ZAI_MODEL || "glm-5",

    // Enable thinking mode (thinking is stripped from output automatically)
    enableThinking: false,
  },

  websocket: {
    maxReconnectAttempts: 10,
  },

  knownModels: ["glm-5", "glm-4.7", "glm-4.6", "glm-4.5", "glm-4.5-air"],
};
