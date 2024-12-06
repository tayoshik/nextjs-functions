const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
app.http('hello', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            // Blobサービスクライアントの作成
            const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);

            // コンテナの一覧を取得
            const containers = [];
            for await (const container of blobServiceClient.listContainers()) {
                const containerClient = blobServiceClient.getContainerClient(container.name);
                const blobs = [];

                // 各コンテナ内のBlobを取得
                for await (const blob of containerClient.listBlobsFlat()) {
                    blobs.push({
                        name: blob.name,
                        lastModified: blob.properties.lastModified,
                        size: blob.properties.contentLength
                    });
                }

                containers.push({
                    name: container.name,
                    blobs: blobs
                });
            }

            return {
                jsonBody: {
                    containers: containers
                }
            };
        } catch (error) {
            context.log.error('Error:', error);
            return {
                status: 500,
                jsonBody: {
                    error: 'Failed to fetch blob list',
                    details: error.message
                }
            };
        }
    }
});