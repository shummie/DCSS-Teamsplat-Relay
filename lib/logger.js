import winston, { format } from 'winston';
import { inspect } from 'util';

function formatter(info) {
  const stringifiedRest = inspect(
    Object.assign({}, info, {
      level: undefined,
      message: undefined,
      splat: undefined
    }),
    { depth: null }
  );

  const padding = (info.padding && info.padding[info.level]) || '';
  if (stringifiedRest !== '{}') {
    return `${info.timestamp} ${info.level}:${padding} ${info.message} ${stringifiedRest}`;
  }

  return `${info.timestamp} ${info.level}:${padding} ${info.message}`;
}

const logger = winston.createLogger({
  transports: [new winston.transports.Console()],
  level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
  format: format.combine(
    format.colorize(),
    format.timestamp(),
    format.printf(formatter)
  )
});

export default logger;
