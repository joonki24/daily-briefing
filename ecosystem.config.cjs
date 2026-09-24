// pm2 설정. package.json이 "type": "module"이라 pm2 설정 파일만 .cjs여야 한다.
module.exports = {
  apps: [
    {
      name: "daily-briefing",
      script: "src/index.js",
      cwd: __dirname,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      env: { NODE_ENV: "production" },
    },
  ],
};
