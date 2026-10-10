import jdk.internal.agent.resources.agent
pipeline {
    agent any;
    environment {
        TAG = "${BRANCH_NAME == 'main' ? 'project-omega:main' : "project-omega:branch-${GIT_COMMIT.take(12)}"}"
    }
    stages {
        stage('Build') {
            steps {
                echo "Building ${env.TAG}"
                script {
                    docker.build(env.TAG)
                }
            }
        }
        stage('Test') {
            environment {
                OPENROUTER_API_KEY = credentials('341a4e99-85d0-48d2-94e8-db3b96bf7e12')
                SNARKYTYPE_CLIENT_ID = credentials('b6f17aa7-3444-457d-b176-20b460f8e717')
                SNARKYTYPE_CLIENT_SECRET = credentials('17654df0-6759-48cb-838a-f203495c8fa5')
            }
            steps {
                echo "Testing ${env.TAG}"
                sh '''
                    docker run --rm \
                        -e OPENROUTER_API_KEY \
                        -e SNARKYTYPE_CLIENT_ID \
                        -e SNARKYTYPE_CLIENT_SECRET \
                        "$TAG" \
                        node /home/node/app/scripts/test-ai-bad-word-review.js
                '''
            }
        }
        stage('Deploy') {
            when {
                branch 'main'
            }
            environment {
                OPENROUTER_API_KEY = credentials('341a4e99-85d0-48d2-94e8-db3b96bf7e12')
                SNARKYTYPE_CLIENT_ID = credentials('b6f17aa7-3444-457d-b176-20b460f8e717')
                SNARKYTYPE_CLIENT_SECRET = credentials('17654df0-6759-48cb-838a-f203495c8fa5')
            }
            steps {
                // I am not proud of this, but for now just tear down and set up the container directly on the agent
                sh '''
                    docker compose -f "deploy/main/docker-compose.yml" up -d
                '''
            }
        }
    }
}
