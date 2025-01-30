FROM public.ecr.aws/lambda/nodejs:22 as builder
WORKDIR /usr/app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
RUN npm run build:mcp-server
    
FROM public.ecr.aws/lambda/nodejs:22
WORKDIR ${LAMBDA_TASK_ROOT}
COPY --from=builder /usr/app/dist/* ./dist/
CMD ["dist/index.handler"]